/**
 * Read card images into structured data with Claude vision.
 *
 *   npm run extract:cards --workspace @danger-room/data -- [options]
 *
 *   --images <dir>   Where card scans live (default: assets/characterCardImages)
 *   --limit <n>      Only process the first n characters (start here)
 *   --sync           Run immediately instead of via the Batch API
 *   --all            Re-extract every character, not just the incomplete ones
 *   --model <id>     Override the model
 *   --dry-run        Resolve images and report the plan; call nothing
 *
 * Fills the gaps the Cerebro + BSData import cannot: characters released after
 * BSData stopped updating, which have metadata but no rules text.
 *
 * Everything it writes is `source: 'ocr'`, `verified: false`. A vision model
 * reading a card is a good first pass, not a substitute for someone checking it
 * against the printed card.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { characters as corpus } from '../src/characters.js';
import { buildSystemPrompt, crossCheck, ExtractedCard } from '../src/import/extraction.js';
import { slugify } from '../src/import/slug.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');
const OUT_DIR = resolve(pkgRoot, '.import');

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : fallback;
};

const IMAGE_DIR = resolve(repoRoot, option('images', 'assets/characterCardImages') as string);
const MODEL = option('model', 'claude-sonnet-5') as string;
const LIMIT = Number(option('limit', '0'));
const DRY_RUN = flag('dry-run');
const SYNC = flag('sync');
const ALL = flag('all');

// ---------------------------------------------------------------------------
// Image resolution
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/**
 * Build a lookup from every image on disk, keyed by a slug of its filename.
 *
 * Filenames vary by source — Cerebro records `ABOMINATION_healthy.png` while
 * the local scans use `amazing_spiderman_healthy.jpg` — so matching on the
 * exact string finds almost nothing. Slugging both sides handles the casing
 * and separator differences without resorting to fuzzy matching, which would
 * happily pair two different characters.
 */
function indexImages(dir: string): Map<string, string> {
  const index = new Map<string, string>();
  if (!existsSync(dir)) return index;

  for (const file of readdirSync(dir)) {
    const ext = extname(file).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    index.set(slugify(basename(file, ext)), resolve(dir, file));
  }
  return index;
}

const MEDIA: Record<string, 'image/png' | 'image/jpeg' | 'image/webp'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Try the recorded filename first, then conventional variants of the id. */
function resolveSide(
  index: Map<string, string>,
  recorded: string | null,
  id: string,
  side: 'healthy' | 'injured',
): string | undefined {
  const candidates = [
    recorded ? slugify(basename(recorded, extname(recorded))) : null,
    `${id}-${side}`,
    `${id}_${side}`,
    slugify(`${id} ${side}`),
  ].filter((c): c is string => Boolean(c));

  for (const c of candidates) {
    const hit = index.get(c);
    if (hit) return hit;
  }
  return undefined;
}

function encode(path: string) {
  return {
    media_type: MEDIA[extname(path).toLowerCase()] ?? 'image/png',
    data: readFileSync(path).toString('base64'),
  };
}

// ---------------------------------------------------------------------------

interface Job {
  id: string;
  known: {
    name?: string;
    threat?: number;
    affiliations?: string[];
    healthyStamina?: number;
    injuredStamina?: number;
  };
  healthyPath: string;
  injuredPath: string;
}

function buildJobs(): { jobs: Job[]; noImages: string[] } {
  const index = indexImages(IMAGE_DIR);

  // Which characters need work? Everything by default is wasteful — the point
  // is to fill gaps, and 190-odd characters already have full stat blocks.
  const needsPath = resolve(OUT_DIR, 'needs-data.json');
  const needing: Set<string> = ALL
    ? new Set(corpus.map(c => c.id))
    : new Set(
        existsSync(needsPath)
          ? (JSON.parse(readFileSync(needsPath, 'utf8')).needsData as { id: string }[]).map(
              n => n.id,
            )
          : [],
      );

  if (needing.size === 0 && !ALL) {
    console.log('Nothing to extract — .import/needs-data.json is empty or missing.');
    console.log('Run `npm run import:cards` first, or pass --all.');
  }

  const jobs: Job[] = [];
  const noImages: string[] = [];

  for (const id of [...needing].sort()) {
    const known = corpus.find(c => c.id === id);
    const healthyPath = resolveSide(index, known?.healthy.cardImage ?? null, id, 'healthy');
    const injuredPath = resolveSide(index, known?.injured.cardImage ?? null, id, 'injured');

    if (!healthyPath || !injuredPath) {
      noImages.push(id);
      continue;
    }

    jobs.push({
      id,
      known: {
        ...(known?.name ? { name: known.name } : {}),
        ...(known?.threat !== undefined ? { threat: known.threat } : {}),
        ...(known?.affiliations ? { affiliations: known.affiliations } : {}),
        ...(known?.healthy.stamina !== undefined
          ? { healthyStamina: known.healthy.stamina }
          : {}),
        ...(known?.injured.stamina !== undefined
          ? { injuredStamina: known.injured.stamina }
          : {}),
      },
      healthyPath,
      injuredPath,
    });
  }

  return { jobs: LIMIT > 0 ? jobs.slice(0, LIMIT) : jobs, noImages };
}

function requestFor(job: Job) {
  const healthy = encode(job.healthyPath);
  const injured = encode(job.injuredPath);

  return {
    model: MODEL,
    max_tokens: 16000,
    system: buildSystemPrompt(),
    output_config: { format: zodOutputFormat(ExtractedCard) },
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Healthy side:' },
          { type: 'image' as const, source: { type: 'base64' as const, ...healthy } },
          { type: 'text' as const, text: 'Injured side:' },
          { type: 'image' as const, source: { type: 'base64' as const, ...injured } },
          {
            type: 'text' as const,
            text: 'Transcribe this character exactly as printed.',
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------

interface Extraction {
  id: string;
  card: ExtractedCard;
  disagreements: ReturnType<typeof crossCheck>;
}

async function runSync(client: Anthropic, jobs: Job[]): Promise<Extraction[]> {
  const out: Extraction[] = [];

  for (const [i, job] of jobs.entries()) {
    process.stdout.write(`  [${i + 1}/${jobs.length}] ${job.id}… `);
    const response = await client.messages.parse(requestFor(job));

    if (!response.parsed_output) {
      console.log('no structured output');
      continue;
    }
    const disagreements = crossCheck(response.parsed_output, job.known);
    out.push({ id: job.id, card: response.parsed_output, disagreements });
    console.log(
      `${response.parsed_output.legibility}` +
        (disagreements.length ? ` · ${disagreements.length} disagreements` : ''),
    );
  }
  return out;
}

/**
 * Batch API — the default.
 *
 * Half price, and a corpus import has no latency requirement. Results come back
 * in arbitrary order, so they are keyed by `custom_id` rather than position.
 */
async function runBatch(client: Anthropic, jobs: Job[]): Promise<Extraction[]> {
  const batch = await client.messages.batches.create({
    requests: jobs.map(job => ({ custom_id: job.id, params: requestFor(job) })),
  });
  console.log(`  batch ${batch.id} submitted (${jobs.length} requests)`);
  writeFileSync(resolve(OUT_DIR, 'batch-id.txt'), batch.id + '\n');

  let status = batch;
  while (status.processing_status !== 'ended') {
    await new Promise(r => setTimeout(r, 30_000));
    status = await client.messages.batches.retrieve(batch.id);
    process.stdout.write(
      `  ${status.processing_status} · ${status.request_counts.processing} processing, ` +
        `${status.request_counts.succeeded} done\r`,
    );
  }
  console.log('\n  batch complete');

  const byId = new Map(jobs.map(j => [j.id, j]));
  const out: Extraction[] = [];

  for await (const result of await client.messages.batches.results(batch.id)) {
    const job = byId.get(result.custom_id);
    if (!job) continue;

    if (result.result.type !== 'succeeded') {
      console.log(`  ${result.custom_id}: ${result.result.type}`);
      continue;
    }

    const block = result.result.message.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') continue;

    const parsed = ExtractedCard.safeParse(JSON.parse(block.text));
    if (!parsed.success) {
      console.log(`  ${result.custom_id}: output did not match schema`);
      continue;
    }
    out.push({
      id: job.id,
      card: parsed.data,
      disagreements: crossCheck(parsed.data, job.known),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const { jobs, noImages } = buildJobs();

  console.log(`Images:  ${IMAGE_DIR}`);
  console.log(`Model:   ${MODEL}${SYNC ? ' (sync)' : ' (batch — 50% cheaper)'}`);
  console.log(`Jobs:    ${jobs.length} character(s) with both card sides on disk`);
  if (noImages.length > 0) {
    console.log(`Skipped: ${noImages.length} with no images available`);
    writeFileSync(
      resolve(OUT_DIR, 'missing-images.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), ids: noImages }, null, 2) + '\n',
    );
  }

  if (jobs.length === 0) {
    console.log('\nNothing to do. Card scans need to be in the images directory,');
    console.log('named after the character (e.g. "black-widow-healthy.png").');
    return;
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: would send');
    for (const job of jobs.slice(0, 10)) {
      console.log(`  ${job.id}\n    ${basename(job.healthyPath)}\n    ${basename(job.injuredPath)}`);
    }
    if (jobs.length > 10) console.log(`  … and ${jobs.length - 10} more`);
    return;
  }

  const client = new Anthropic();
  console.log('');
  const results = SYNC ? await runSync(client, jobs) : await runBatch(client, jobs);

  const flagged = results.filter(r => r.disagreements.length > 0 || r.card.legibility !== 'clear');

  writeFileSync(
    resolve(OUT_DIR, 'extracted.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, results }, null, 2) +
      '\n',
  );
  writeFileSync(
    resolve(OUT_DIR, 'extraction-review.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'Extractions that disagree with Cerebro or that the model flagged as hard to read. Check these against the printed card before setting verified: true.',
        flagged,
      },
      null,
      2,
    ) + '\n',
  );

  console.log(`\n✓ ${results.length} extracted → .import/extracted.json`);
  console.log(`  ${flagged.length} need review → .import/extraction-review.json`);
  console.log('\nNothing is merged into the corpus automatically — review first,');
  console.log('then fold the accepted extractions in.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
