/**
 * List every extraction defect a machine can find, for manual correction.
 *
 *   npm run report:defects --workspace @danger-room/data
 *
 * Three kinds, in descending order of certainty:
 *
 *   impossible-trigger  A bullet's leading icons include a symbol no trigger
 *                       can carry. Definitely wrong — no reference data needed.
 *   unreadable-icon     The model emitted {UNKNOWN}: it saw an icon and could
 *                       not name it. Definitely incomplete, and it said so.
 *   legibility          The model rated the whole card "partial" or "poor".
 *
 * What this cannot find is the dangerous class: a plausible reading that is
 * simply wrong. Bastion's Suppression trigger is transcribed {CRIT} and the
 * card prints the Wild coil; {CRIT} is a legal trigger symbol, so nothing here
 * objects. Those surface only by eye against the scan.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkTriggerIcons, type ExtractedCard } from '../src/import/extraction.js';
import { OverrideFile } from '../src/import/overrides.js';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(pkgRoot, '.import');
const SOURCE = resolve(OUT_DIR, 'extracted.json');
const OVERRIDES = resolve(pkgRoot, 'overrides.json');

interface Defect {
  readonly kind: 'impossible-trigger' | 'unreadable-icon' | 'legibility';
  readonly side: string;
  readonly where: string;
  readonly detail: string;
}

const triggerName = (text: string): string =>
  text.match(/(?:<b>)?([A-Za-z][A-Za-z '!-]{1,24}?)(?:<\/b>)?\s*:/)?.[1]?.trim() ?? '?';

function defectsFor(card: ExtractedCard): Defect[] {
  const out: Defect[] = [];

  for (const p of checkTriggerIcons(card)) {
    out.push({
      kind: 'impossible-trigger',
      side: p.side,
      where: `${p.attack} / ${triggerName(p.text)}`,
      detail: `{${p.offenders.join('} {')}} cannot lead a trigger`,
    });
  }

  for (const side of ['healthy', 'injured'] as const) {
    const scan = (where: string, texts: string[]) => {
      for (const t of texts) {
        const n = (t.match(/\{UNKNOWN\}/g) ?? []).length;
        if (n > 0) {
          out.push({
            kind: 'unreadable-icon',
            side,
            where,
            detail: `${n} unidentified icon${n > 1 ? 's' : ''}`,
          });
        }
      }
    };
    for (const a of card[side].attacks) scan(a.name, a.text);
    for (const p of card[side].superpowers) scan(p.name, [p.text]);
  }

  if (card.legibility !== 'clear') {
    out.push({ kind: 'legibility', side: '', where: 'whole card', detail: card.legibility });
  }
  return out;
}

function main() {
  if (!existsSync(SOURCE)) throw new Error(`No ${SOURCE}. Run the extractor first.`);
  const results = JSON.parse(readFileSync(SOURCE, 'utf8')).results as {
    id: string;
    card: ExtractedCard;
  }[];

  /*
   * Corrections do not change the extraction — they are applied after it — so
   * a character stays on this list forever once reviewed. Marking the ones
   * already corrected is what keeps the list a worklist rather than a tally.
   */
  const corrected = new Set(
    existsSync(OVERRIDES)
      ? OverrideFile.parse(JSON.parse(readFileSync(OVERRIDES, 'utf8')))
          .overrides.filter(o => o.verified)
          .map(o => o.id)
      : [],
  );

  const lines: string[] = [];
  const totals: Record<string, number> = {
    'impossible-trigger': 0,
    'unreadable-icon': 0,
    legibility: 0,
  };
  let affected = 0;

  for (const { id, card } of [...results].sort((a, b) => a.id.localeCompare(b.id))) {
    const defects = defectsFor(card);
    if (defects.length === 0) continue;
    affected++;

    const counts: Record<string, number> = {};
    for (const d of defects) {
      counts[d.kind] = (counts[d.kind] ?? 0) + 1;
      totals[d.kind] = (totals[d.kind] ?? 0) + 1;
    }

    const mark = corrected.has(id) ? '  ✓ corrected by a verified override' : '';
    lines.push(
      `${id}  [${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}]${mark}`,
    );
    for (const d of defects) {
      lines.push(`      ${d.kind.padEnd(19)} ${d.side.padEnd(8)} ${d.where}  —  ${d.detail}`);
    }
    lines.push('');
  }

  const report = lines.join('\n');
  console.log(report);
  const outstanding = [...new Set(lines.filter(l => /^\S/.test(l)).map(l => l.split(' ')[0]))].filter(
    id => !corrected.has(id),
  );
  console.log(`${affected} of ${results.length} characters have at least one detectable defect`);
  console.log(`  ${affected - outstanding.length} already corrected, ${outstanding.length} outstanding`);
  for (const [kind, n] of Object.entries(totals)) console.log(`  ${kind.padEnd(20)} ${n}`);
  console.log('\nNot listed: readings that are plausible but wrong — those need the scan.');

  const path = resolve(OUT_DIR, 'defects.txt');
  writeFileSync(path, report + '\n');
  console.log(`\n→ ${path}`);
}

main();
