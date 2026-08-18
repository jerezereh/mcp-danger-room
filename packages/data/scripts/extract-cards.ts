/**
 * Read card images into structured data with Claude vision.
 *
 *   npm run extract:cards --workspace @danger-room/data -- [options]
 *
 *   --images <dir>   Local card scans (default: assets/characterCardImages)
 *   --local-only     Don't fall back to downloading scans from Cerebro
 *   --limit <n>      Only process the first n characters (start here)
 *   --sync           Run immediately instead of via the Batch API
 *   --all            Re-extract every character, not just the incomplete ones
 *   --model <id>     Override the model
 *   --resume <id>    Re-retrieve a finished batch ("last" for the most recent)
 *   --only <ids>     Comma-separated character ids, or "failed" to retry the
 *                    ones that failed last run
 *   --dry-run        Resolve images and report the plan; call nothing
 *
 * Fills the gaps the Cerebro + BSData import cannot: characters released after
 * BSData stopped updating, which have metadata but no rules text.
 *
 * Everything it writes is `source: 'ocr'`, `verified: false`. A vision model
 * reading a card is a good first pass, not a substitute for someone checking it
 * against the printed card.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { characters as corpus } from '../src/characters.js';
import { cardImageUrl } from '../src/import/cerebro.js';
import {
  buildSystemPrompt,
  checkTriggerIcons,
  crossCheck,
  ExtractedCard,
} from '../src/import/extraction.js';
import { slugify } from '../src/import/slug.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');
const OUT_DIR = resolve(pkgRoot, '.import');
const CACHE_DIR = resolve(OUT_DIR, 'card-images');
const BATCH_ID_FILE = resolve(OUT_DIR, 'batch-id.txt');

const readBatchId = (): string => {
  if (!existsSync(BATCH_ID_FILE)) throw new Error('No .import/batch-id.txt to resume from.');
  return readFileSync(BATCH_ID_FILE, 'utf8').trim();
};

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
const LOCAL_ONLY = flag('local-only');
/** Batch id to re-retrieve, or "last" for the most recent. */
const RESUME = option('resume');
/**
 * Restrict the run to specific characters, or to whatever failed last time.
 *
 * Without this, retrying three truncated cards means resubmitting all 41 and
 * paying for the 38 that were already fine.
 */
const ONLY = option('only');

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
function resolveLocal(
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

/**
 * Fetch a card scan from Cerebro, caching it on disk.
 *
 * This is what makes the extractor usable at all: the characters that need OCR
 * are recent releases, which is precisely the set nobody has local scans of.
 * Cerebro's API already gives us the exact filename, and its web app serves
 * those from a predictable path.
 *
 * Cached because the images are ~1MB each and the host is a volunteer project —
 * re-downloading 80 of them on every run would be rude, and slow.
 */
async function fetchRemote(filename: string): Promise<string | undefined> {
  const cached = resolve(CACHE_DIR, filename);
  if (existsSync(cached)) return cached;

  const response = await fetch(cardImageUrl(filename));
  if (!response.ok) return undefined;

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  return cached;
}

function encode(path: string) {
  return {
    media_type: MEDIA[extname(path).toLowerCase()] ?? 'image/png',
    data: readFileSync(path).toString('base64'),
  };
}

// ---------------------------------------------------------------------------

/** One row of .import/needs-data.json, plus what --all synthesizes. */
interface WorklistEntry {
  id: string;
  name?: string;
  threat?: number;
  affiliations?: string[];
  healthyImage?: string | null;
  injuredImage?: string | null;
  healthyStamina?: number;
  injuredStamina?: number;
  errata?: string | null;
}

interface Job {
  id: string;
  known: {
    name?: string;
    affiliations?: string[];
    healthyStamina?: number;
    injuredStamina?: number;
    errata?: string | null;
  };
  healthyPath: string;
  injuredPath: string;
}

async function buildJobs(): Promise<{ jobs: Job[]; noImages: string[]; fetched: number }> {
  const index = indexImages(IMAGE_DIR);

  // Which characters need work? Everything by default is wasteful — the point
  // is to fill gaps, and 190-odd characters already have full stat blocks.
  const needsPath = resolve(OUT_DIR, 'needs-data.json');
  const worklist: WorklistEntry[] = existsSync(needsPath)
    ? (JSON.parse(readFileSync(needsPath, 'utf8')).needsData as WorklistEntry[])
    : [];

  /*
   * Characters needing extraction are, by definition, the ones that failed to
   * finalize — so they are absent from characters.json and cannot be looked up
   * there. The worklist written by import-cards carries their metadata and card
   * image filenames precisely so this script has something to work from.
   */
  const known = new Map<string, WorklistEntry>();
  for (const entry of worklist) known.set(entry.id, entry);
  for (const c of corpus) {
    if (ALL && !known.has(c.id)) {
      known.set(c.id, {
        id: c.id,
        name: c.name,
        threat: c.threat,
        affiliations: c.affiliations,
        healthyImage: c.healthy.cardImage,
        injuredImage: c.injured.cardImage,
        healthyStamina: c.healthy.stamina,
        injuredStamina: c.injured.stamina,
        errata: c.errata,
      });
    }
  }

  let needing = new Set(ALL ? known.keys() : worklist.map(e => e.id));

  if (ONLY) {
    const wanted =
      ONLY === 'failed'
        ? (() => {
            const path = resolve(OUT_DIR, 'extraction-failures.json');
            if (!existsSync(path)) throw new Error('No .import/extraction-failures.json to retry.');
            return (JSON.parse(readFileSync(path, 'utf8')).failures as { id: string }[]).map(
              f => f.id,
            );
          })()
        : ONLY.split(',').map(x => x.trim()).filter(Boolean);

    needing = new Set(wanted.filter(id => known.has(id) || needing.has(id)));
    for (const id of wanted) {
      if (!needing.has(id)) console.log(`  ⚠ "${id}" is not in the worklist — skipping`);
    }
  }

  if (needing.size === 0 && !ALL) {
    console.log('Nothing to extract — .import/needs-data.json is empty or missing.');
    console.log('Run `npm run import:cards` first, or pass --all.');
  }

  const jobs: Job[] = [];
  const noImages: string[] = [];
  let fetched = 0;

  for (const id of [...needing].sort()) {
    const entry = known.get(id);

    // Local scans first — free, and the user may have better ones. Fall back to
    // Cerebro, which is the only source for recently-released characters.
    const side = async (which: 'healthy' | 'injured') => {
      const recorded = (which === 'healthy' ? entry?.healthyImage : entry?.injuredImage) ?? null;
      const local = resolveLocal(index, recorded, id, which);
      if (local || LOCAL_ONLY || !recorded) return local;

      const remote = await fetchRemote(recorded);
      if (remote) fetched++;
      return remote;
    };

    const healthyPath = await side('healthy');
    const injuredPath = await side('injured');

    if (!healthyPath || !injuredPath) {
      noImages.push(id);
      continue;
    }

    jobs.push({
      id,
      known: {
        ...(entry?.name ? { name: entry.name } : {}),
        ...(entry?.affiliations ? { affiliations: entry.affiliations } : {}),
        ...(entry?.healthyStamina !== undefined
          ? { healthyStamina: entry.healthyStamina }
          : {}),
        ...(entry?.injuredStamina !== undefined
          ? { injuredStamina: entry.injuredStamina }
          : {}),
        // Without this, every errata'd character reports a false stamina
        // mismatch — the scan is pre-errata, the corpus is current.
        ...(entry?.errata ? { errata: entry.errata } : {}),
      },
      healthyPath,
      injuredPath,
    });
  }

  return { jobs: LIMIT > 0 ? jobs.slice(0, LIMIT) : jobs, noImages, fetched };
}

function requestFor(job: Job) {
  const healthy = encode(job.healthyPath);
  const injured = encode(job.injuredPath);

  return {
    model: MODEL,
    /*
     * Generous because max_tokens covers thinking *and* the response, and
     * Sonnet 5 thinks by default. At 16000, three of 41 cards ran out mid-JSON
     * — one spent the entire budget thinking and emitted no text at all.
     * A truncated card costs a full rerun, so headroom is far cheaper than
     * the retry.
     */
    max_tokens: 32000,
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

type ParseOutcome =
  | { ok: true; card: ExtractedCard }
  | { ok: false; error: string };

/**
 * Pull the structured output out of a finished message.
 *
 * Shared by both paths so a truncated or malformed response is handled
 * identically whether it came back over a stream or out of a batch — the batch
 * path learned this the hard way when one bad card threw and discarded 40 good
 * results with it.
 */
function parseMessage(message: {
  content: { type: string; text?: string }[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}): ParseOutcome {
  const block = message.content.find(b => b.type === 'text');
  const raw = block?.text ?? '';

  if (message.stop_reason === 'max_tokens' || raw.trim() === '') {
    return {
      ok: false,
      error: `hit max_tokens (${message.usage.output_tokens} output tokens); response was cut off`,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `unparseable JSON: ${(error as Error).message}` };
  }

  const parsed = ExtractedCard.safeParse(json);
  return parsed.success
    ? { ok: true, card: parsed.data }
    : {
        ok: false,
        error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      };
}

let totalIn = 0;
let totalOut = 0;
const failures: { id: string; error: string }[] = [];

async function runSync(client: Anthropic, jobs: Job[]): Promise<Extraction[]> {
  const out: Extraction[] = [];

  for (const [i, job] of jobs.entries()) {
    process.stdout.write(`  [${i + 1}/${jobs.length}] ${job.id}… `);

    /*
     * Streamed, not a plain request. Above ~16k max_tokens the SDK refuses a
     * non-streaming call outright ("Streaming is required for operations that
     * may take longer than 10 minutes"), and these cards need the headroom.
     *
     * One card failing must not abandon the rest of the run: overloads and
     * rate limits are transient and were observed in practice, and losing 40
     * good extractions to the 41st is the wrong trade. Failures are recorded
     * and reported rather than disappearing.
     */
    let message;
    try {
      const stream = client.messages.stream(requestFor(job));
      message = await stream.finalMessage();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`failed — ${detail.split('\n')[0]?.slice(0, 70)}`);
      failures.push({ id: job.id, error: detail });
      continue;
    }

    totalIn += message.usage.input_tokens;
    totalOut += message.usage.output_tokens;

    const outcome = parseMessage(message);
    if (!outcome.ok) {
      console.log(outcome.error.slice(0, 70));
      failures.push({ id: job.id, error: outcome.error });
      continue;
    }

    const disagreements = crossCheck(outcome.card, job.known);
    out.push({ id: job.id, card: outcome.card, disagreements });

    const unexplained = disagreements.filter(d => !d.explained).length;
    console.log(
      `${outcome.card.legibility} · ` +
        `${message.usage.input_tokens}in/${message.usage.output_tokens}out` +
        (unexplained ? ` · ${unexplained} to review` : ''),
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
  /*
   * Resume an existing batch instead of submitting a new one.
   *
   * Results stay retrievable for 29 days, so a client-side crash after a batch
   * completes must never mean paying for it twice. The id is written to disk
   * the moment the batch is created, precisely so this is recoverable.
   */
  const resumeId = RESUME === 'last' ? readBatchId() : RESUME;
  const batch = resumeId
    ? await client.messages.batches.retrieve(resumeId)
    : await client.messages.batches.create({
        requests: jobs.map(job => ({ custom_id: job.id, params: requestFor(job) })),
      });

  if (resumeId) console.log(`  resuming batch ${batch.id}`);
  else {
    console.log(`  batch ${batch.id} submitted (${jobs.length} requests)`);
    writeFileSync(resolve(OUT_DIR, 'batch-id.txt'), batch.id + '\n');
  }

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

    /*
     * Parse defensively. A card whose JSON is truncated — the model hit
     * max_tokens mid-object — throws here, and an uncaught throw discards the
     * whole retrieval including every result that was fine. That is the worst
     * possible failure for a batch that has already been paid for.
     */
    const message = result.result.message;
    const block = message.content.find(b => b.type === 'text');
    const raw = block && block.type === 'text' ? block.text : '';

    if (message.stop_reason === 'max_tokens' || raw.trim() === '') {
      console.log(
        `  ${result.custom_id}: truncated (stop=${message.stop_reason}, ` +
          `${message.usage.output_tokens} output tokens) — needs a rerun`,
      );
      failures.push({
        id: result.custom_id,
        error: `hit max_tokens (${message.usage.output_tokens} output tokens); response was cut off`,
      });
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      console.log(`  ${result.custom_id}: unparseable JSON`);
      failures.push({ id: result.custom_id, error: (error as Error).message });
      continue;
    }

    const parsed = ExtractedCard.safeParse(json);
    if (!parsed.success) {
      console.log(`  ${result.custom_id}: output did not match schema`);
      failures.push({
        id: result.custom_id,
        error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      continue;
    }
    totalIn += message.usage.input_tokens;
    totalOut += message.usage.output_tokens;
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

  const { jobs, noImages, fetched } = await buildJobs();

  console.log(`Images:  ${IMAGE_DIR}${LOCAL_ONLY ? ' (local only)' : ' + Cerebro'}`);
  if (fetched > 0) console.log(`         ${fetched} downloaded from Cerebro → .import/card-images/`);
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
    console.log('\nNothing to do.');
    if (LOCAL_ONLY) console.log('Drop --local-only to fetch card scans from Cerebro.');
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

  // Only *unexplained* disagreements warrant review — a pre-errata scan
  // reading the printed value is expected, and flagging 136 of those would
  // bury the real misreads.


  /*
   * Accumulate rather than replace.
   *
   * A partial run — retrying three failures with --only — must not delete the
   * thirty-eight extractions already paid for. Results are keyed by id so a
   * rerun of the same character supersedes its previous attempt, and everything
   * else is carried forward untouched.
   */
  const extractedPath = resolve(OUT_DIR, 'extracted.json');
  const previous: Extraction[] = existsSync(extractedPath)
    ? ((JSON.parse(readFileSync(extractedPath, 'utf8')).results ?? []) as Extraction[])
    : [];

  const byId = new Map(previous.map(e => [e.id, e]));
  for (const e of results) byId.set(e.id, e);
  const all = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

  const carried = all.length - results.length;
  if (carried > 0) console.log(`  (carried forward ${carried} from earlier runs)`);

  writeFileSync(
    extractedPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), model: MODEL, results: all },
      null,
      2,
    ) + '\n',
  );
  /*
   * Structural check on trigger icons.
   *
   * A bullet's leading icons are always dice results, so anything else there
   * is a misread that needs no reference data to detect. It matters because
   * these misreads produce *valid* tokens — the Wild coil as {ENRG}, the Hit
   * burst as {PWR} — and a wrong-but-valid token is indistinguishable from a
   * right one by eye.
   */
  const triggerProblems = all.flatMap(r =>
    checkTriggerIcons(r.card).map(p => ({ id: r.id, ...p })),
  );
  if (triggerProblems.length > 0) {
    const byToken: Record<string, number> = {};
    for (const p of triggerProblems) for (const o of p.offenders) byToken[o] = (byToken[o] ?? 0) + 1;
    console.log(
      `\n⚠ ${triggerProblems.length} trigger bullets lead with a symbol no trigger can carry:`,
    );
    for (const [token, n] of Object.entries(byToken).sort((a, b) => b[1] - a[1])) {
      console.log(`    {${token}} x${n}`);
    }
    console.log('  These are misreads, not flags — see .import/extraction-review.json');
  }

  const flagged = all.filter(
    r =>
      r.disagreements.some(d => !d.explained) ||
      r.card.legibility !== 'clear' ||
      checkTriggerIcons(r.card).length > 0,
  );

  writeFileSync(
    resolve(OUT_DIR, 'extraction-review.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'Extractions that disagree with Cerebro, that the model flagged as hard to read, or whose trigger bullets lead with a non-dice symbol. Check these against the printed card before setting verified: true.',
        triggerProblems,
        flagged,
      },
      null,
      2,
    ) + '\n',
  );

  if (totalIn > 0) {
    // Sonnet 5 introductory pricing; batch halves it.
    const cost = (totalIn / 1e6) * 2 + (totalOut / 1e6) * 10;
    const per = cost / Math.max(1, results.length);
    console.log(
      `\nTokens: ${totalIn} in / ${totalOut} out · ~$${cost.toFixed(3)} ` +
        `(~$${per.toFixed(3)}/card, about $${(per * 41 * 0.5).toFixed(2)} for all 41 via batch)`,
    );
  }

  const failuresPath = resolve(OUT_DIR, 'extraction-failures.json');
  if (failures.length === 0 && existsSync(failuresPath)) {
    // Everything this run attempted succeeded; don't leave a stale retry list
    // that would make `--only failed` re-run cards that are already fine.
    rmSync(failuresPath);
  }

  if (failures.length > 0) {
    console.log(`\n⚠ ${failures.length} failed — rerun to retry just these:`);
    for (const f of failures.slice(0, 5)) console.log(`    ${f.id}: ${f.error.slice(0, 70)}`);
    writeFileSync(
      resolve(OUT_DIR, 'extraction-failures.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), failures }, null, 2) + '\n',
    );
  }

  console.log(`\n✓ ${all.length} extracted total → .import/extracted.json`);
  console.log(`  ${flagged.length} need review → .import/extraction-review.json`);
  console.log('\nNothing is merged into the corpus automatically — review first,');
  console.log('then fold the accepted extractions in.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
