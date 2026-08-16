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
  fetchCerebroCharacters,
  finalize,
  mergeDrafts,
  parseBsdata,
  toDraft,
  type CharacterDraft,
} from '../src/import/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const OUT_DIR = resolve(pkgRoot, '.import');
const CORPUS = resolve(pkgRoot, 'src/characters.json');

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

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('Fetching Cerebro…');
  const cerebroRaw = await fetchCerebroCharacters();
  const cerebro = cerebroRaw.map(toDraft);
  console.log(`  ${cerebro.length} characters`);

  console.log('Parsing BSData…');
  const [catalogue, gameSystem] = await Promise.all([
    cached(BSDATA_CAT, BSDATA_URLS.cat),
    cached(BSDATA_GST, BSDATA_URLS.gst),
  ]);
  const bsdata = parseBsdata(catalogue, gameSystem);
  console.log(`  ${bsdata.drafts.length} characters, ${bsdata.warnings.length} warnings`);

  console.log('Merging…');
  const merged = mergeDrafts(cerebro, bsdata.drafts);
  console.log(
    `  ${merged.stats.total} total · ${merged.stats.matched} in both · ` +
      `${merged.stats.onlyIn['cerebro'] ?? 0} Cerebro-only · ` +
      `${merged.stats.onlyIn['bsdata'] ?? 0} BSData-only`,
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
  const needsData: { id: string; missing: readonly string[]; sources: string[] }[] = [];

  for (const draft of merged.drafts) {
    const result = finalize(draft, draft.sources.includes('bsdata') ? 'bsdata' : 'cerebro');
    if (!result.ok) {
      needsData.push({ id: result.id, missing: result.missing, sources: draft.sources });
      continue;
    }

    // A draft can satisfy the finalizer (every field present) and still fail
    // the schema (a field present but out of range — a size of 0, a negative
    // stamina). That is a bad parse, not a crash: name it and queue it.
    const parsed = Character.safeParse(result.character);
    if (parsed.success) {
      characters.push(parsed.data);
    } else {
      needsData.push({
        id: draft.id,
        missing: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        sources: draft.sources,
      });
    }
  }

  writeFileSync(CORPUS, JSON.stringify({ characters }, null, 2) + '\n');
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

  console.log(`\n✓ ${characters.length} characters written to src/characters.json`);
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
