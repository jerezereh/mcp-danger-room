/**
 * Download every card scan the corpus references, for the web client to show.
 *
 *   npm run fetch:images --workspace @danger-room/data -- [options]
 *
 *   --out <dir>     Destination (default assets/card-scans)
 *   --concurrency   Parallel downloads (default 4)
 *   --force         Re-download files that already exist
 *   --dry-run       Report what would be fetched and stop
 *
 * About 450 images at roughly a megabyte each, so the destination is
 * gitignored and this is a fetch-once step rather than something in the build.
 * It deliberately sits outside `apps/web/public`, because Vite copies that
 * directory into `dist` and a 410MB build output helps nobody; the dev server
 * serves these from disk instead.
 * Cerebro is a volunteer project: existing files are skipped, the extractor's
 * cache is reused rather than re-fetched, concurrency is low, and the
 * User-Agent says who is calling.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { characters } from '../src/characters.js';
import { cardImageUrl } from '../src/import/cerebro.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '../..');

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const option = (n: string, fallback: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : fallback;
};

const OUT = resolve(repoRoot, option('out', 'assets/card-scans'));
const CONCURRENCY = Math.max(1, Number(option('concurrency', '4')));
const FORCE = flag('force');
const DRY_RUN = flag('dry-run');

/** The extractor already downloaded some of these; copying beats re-fetching. */
const EXTRACTOR_CACHE = resolve(pkgRoot, '.import/card-images');

const wanted = [
  ...new Set(
    characters
      .flatMap(c => [
        c.healthy.cardImage,
        c.injured.cardImage,
        ...c.forms.flatMap(f => [f.healthy.cardImage, f.injured.cardImage]),
      ])
      .filter((f): f is string => Boolean(f)),
  ),
].sort();

async function main() {
  mkdirSync(OUT, { recursive: true });

  const todo: string[] = [];
  let present = 0;
  let copied = 0;

  for (const file of wanted) {
    const dest = resolve(OUT, file);
    if (!FORCE && existsSync(dest)) {
      present++;
      continue;
    }
    const cached = resolve(EXTRACTOR_CACHE, file);
    if (!FORCE && existsSync(cached)) {
      if (!DRY_RUN) copyFileSync(cached, dest);
      copied++;
      continue;
    }
    todo.push(file);
  }

  console.log(`Referenced: ${wanted.length} images`);
  console.log(`Already in ${OUT.replace(repoRoot + '/', '')}: ${present}`);
  console.log(`Copied from the extractor cache: ${copied}`);
  console.log(`To download: ${todo.length}`);

  if (DRY_RUN || todo.length === 0) {
    if (DRY_RUN) console.log('\n--dry-run: downloading nothing.');
    return;
  }

  let done = 0;
  const failed: { file: string; reason: string }[] = [];

  // A small fixed pool rather than Promise.all over 450 requests at once.
  const queue = [...todo];
  const worker = async () => {
    for (;;) {
      const file = queue.shift();
      if (!file) return;
      try {
        const response = await fetch(cardImageUrl(file), {
          headers: {
            'User-Agent': 'mcp-danger-room card importer (github.com/jerezereh/mcp-danger-room)',
          },
        });
        if (!response.ok) {
          failed.push({ file, reason: `HTTP ${response.status}` });
          continue;
        }
        writeFileSync(resolve(OUT, file), Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        failed.push({ file, reason: (error as Error).message });
        continue;
      }
      done++;
      if (done % 25 === 0 || done === todo.length) {
        process.stdout.write(`  ${done}/${todo.length}\r`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n✓ downloaded ${done}`);

  if (failed.length > 0) {
    console.log(`\n⚠ ${failed.length} failed:`);
    for (const f of failed.slice(0, 10)) console.log(`    ${f.file}: ${f.reason}`);
    writeFileSync(
      resolve(pkgRoot, '.import/missing-card-images.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), failed }, null, 2) + '\n',
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
