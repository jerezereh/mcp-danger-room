/**
 * Build the card corpus from Cerebro + BSData.
 *
 *   npm run import:cards --workspace @danger-room/data
 *
 * Writes three things:
 *   src/characters.json  — every character that finalized into a valid record
 *   .import/needs-data.json — characters missing fields, with what's missing
 *   .import/conflicts.json  — where the two sources disagree
 *
 * The last two are the point. A partial corpus plus an explicit worklist beats
 * a "complete" corpus that quietly invented the gaps.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Character } from '../src/schema.js';
import {
  applyOverrides,
  fetchCerebroCharacters,
  finalize,
  mergeDrafts,
  OverrideFile,
  parseBsdata,
  cerebroToDraft,
  type CharacterDraft,
} from '../src/import/index.js';
import { fetchJarvisCharacters, jarvisToDraft } from '../src/import/jarvis.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const OUT_DIR = resolve(pkgRoot, '.import');
const CORPUS = resolve(pkgRoot, 'src/characters.json');

const JARVIS_CACHE = resolve(OUT_DIR, 'jarvis-characters.json');
const OVERRIDES = resolve(pkgRoot, 'overrides.json');

const BSDATA_CAT = resolve(OUT_DIR, 'MCP Inventory.cat');
const BSDATA_GST = resolve(OUT_DIR, 'Marvel Crisis Protocol.gst');

const BSDATA_URLS = {
  cat: 'https://raw.githubusercontent.com/BSData/marvel-crisis-protocol/master/MCP%20Inventory.cat',
  gst: 'https://raw.githubusercontent.com/BSData/marvel-crisis-protocol/master/Marvel%20Crisis%20Protocol.gst',
};

async function cached(path: string, url: string): Promise<string> {
  // Cached deliberately: these are ~2.5MB and the upstream repo is a volunteer
  // project. Re-downloading on every run would be rude and slow.
  if (existsSync(path)) return readFileSync(path, 'utf8');

  process.stdout.write(`  downloading ${url.split('/').pop()}…\n`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);

  const body = await response.text();
  writeFileSync(path, body);
  return body;
}

/** Cache a JSON fetch on disk — one request per source per import at most. */
async function cachedJson<T>(path: string, fetcher: () => Promise<T>): Promise<T> {
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as T;
  const body = await fetcher();
  writeFileSync(path, JSON.stringify(body));
  return body;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('Fetching Cerebro…');
  const cerebroRaw = await fetchCerebroCharacters();
  const cerebro = cerebroRaw.map(cerebroToDraft);
  console.log(`  ${cerebro.length} characters`);

  console.log('Parsing BSData…');
  const [catalogue, gameSystem] = await Promise.all([
    cached(BSDATA_CAT, BSDATA_URLS.cat),
    cached(BSDATA_GST, BSDATA_URLS.gst),
  ]);
  const bsdata = parseBsdata(catalogue, gameSystem);
  console.log(`  ${bsdata.drafts.length} characters, ${bsdata.warnings.length} warnings`);

  // Jarvis is optional: its access is provisional, so a failure degrades the
  // pipeline to Cerebro + BSData rather than breaking the import.
  console.log('Fetching Jarvis…');
  let jarvis: CharacterDraft[] = [];
  try {
    const raw = await cachedJson(JARVIS_CACHE, () => fetchJarvisCharacters());
    jarvis = raw.map(jarvisToDraft);
    console.log(`  ${jarvis.length} characters`);
  } catch (error) {
    console.log(`  unavailable (${(error as Error).message.split('.')[0]}) — continuing without it`);
  }

  console.log('Merging…');
  const merged = mergeDrafts({ cerebro, bsdata: bsdata.drafts, jarvis });
  console.log(
    `  ${merged.stats.total} total · ${merged.stats.matched} in both · ` +
      `${merged.stats.onlyIn['cerebro'] ?? 0} Cerebro-only · ` +
      `${merged.stats.onlyIn['bsdata'] ?? 0} BSData-only · ` +
      `${merged.stats.onlyIn['jarvis'] ?? 0} Jarvis-only`,
  );
  console.log(`  ${merged.conflicts.length} field conflicts`);

  // Group conflicts by field. A field where nearly every record disagrees is a
  // systematic difference between the sources, not scattered bad data — and it
  // reads very differently from a handful of one-off typos, so it is worth
  // surfacing here rather than leaving buried in a long JSON file.
  const byField = new Map<string, number>();
  for (const c of merged.conflicts) byField.set(c.field, (byField.get(c.field) ?? 0) + 1);
  for (const [field, count] of [...byField.entries()].sort((a, b) => b[1] - a[1])) {
    const scale = count > merged.stats.matched * 0.5 ? '  ← systematic, not scattered' : '';
    console.log(`    ${String(count).padStart(4)} ${field}${scale}`);
  }

  const characters = [];

  /*
   * The worklist carries the draft's own metadata, not just its id.
   *
   * These characters by definition never make it into characters.json, so the
   * OCR extractor cannot look them up there — and the card image filenames it
   * needs to fetch scans live only on the draft. Passing them through here is
   * what lets the extractor work on exactly the characters that need it.
   */
  const needsData: {
    id: string;
    missing: readonly string[];
    sources: string[];
    name?: string;
    threat?: number;
    affiliations?: string[];
    healthyImage?: string | null;
    injuredImage?: string | null;
    healthyStamina?: number;
    injuredStamina?: number;
    errata?: string | null;
  }[] = [];

  const worklistEntry = (draft: CharacterDraft, missing: readonly string[]) => ({
    id: draft.id,
    missing,
    sources: draft.sources,
    ...(draft.name ? { name: draft.name } : {}),
    ...(draft.threat !== undefined ? { threat: draft.threat } : {}),
    ...(draft.affiliations ? { affiliations: draft.affiliations } : {}),
    healthyImage: draft.healthy?.cardImage ?? null,
    injuredImage: draft.injured?.cardImage ?? null,
    ...(draft.healthy?.stamina !== undefined ? { healthyStamina: draft.healthy.stamina } : {}),
    ...(draft.injured?.stamina !== undefined ? { injuredStamina: draft.injured.stamina } : {}),
    errata: draft.errata ?? null,
  });

  for (const draft of merged.drafts) {
    const result = finalize(draft);
    if (!result.ok) {
      needsData.push(worklistEntry(draft, result.missing));
      continue;
    }

    // A draft can satisfy the finalizer (every field present) and still fail
    // the schema (a field present but out of range — a size of 0, a negative
    // stamina). That is a bad parse, not a crash: name it and queue it.
    const parsed = Character.safeParse(result.character);
    if (parsed.success) {
      characters.push(parsed.data);
    } else {
      needsData.push(
        worklistEntry(
          draft,
          parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        ),
      );
    }
  }

  // Human corrections win over every source, and are the only way a record
  // becomes verified.
  const overrideFile = existsSync(OVERRIDES)
    ? OverrideFile.parse(JSON.parse(readFileSync(OVERRIDES, 'utf8')))
    : { overrides: [] };
  const patched = applyOverrides(characters, overrideFile.overrides);

  if (overrideFile.overrides.length > 0) {
    console.log(`\nOverrides: ${patched.applied.length} applied`);
    for (const id of patched.unmatched) {
      console.log(`  ⚠ no character matched override id "${id}"`);
    }
  }

  writeFileSync(CORPUS, JSON.stringify({ characters: patched.characters }, null, 2) + '\n');
  writeFileSync(
    resolve(OUT_DIR, 'needs-data.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), needsData }, null, 2) + '\n',
  );
  writeFileSync(
    resolve(OUT_DIR, 'conflicts.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), conflicts: merged.conflicts, warnings: bsdata.warnings },
      null,
      2,
    ) + '\n',
  );

  console.log(`\n✓ ${patched.characters.length} characters written to src/characters.json`);
  console.log(`  ${needsData.length} need more data → .import/needs-data.json`);
  console.log(`  ${merged.conflicts.length} conflicts → .import/conflicts.json`);

  if (needsData.length > 0) {
    console.log('\nRun the OCR extractor to fill the gaps:');
    console.log('  npm run extract:cards --workspace @danger-room/data');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
