/**
 * One-shot migration: the prototype's assets/CharacterCards.json into the
 * normalized schema.
 *
 * Run from the repo root:  node packages/data/scripts/import-legacy.mjs
 *
 * Everything it emits is marked `verified: false` and `source: 'legacy-import'`.
 * The old data was hand-entered and never checked, so importing it as
 * authoritative would launder unverified numbers into a rules engine that acts
 * on them. Treat the output as a starting draft.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const SOURCE = resolve(repoRoot, 'assets/CharacterCards.json');
const OUT = resolve(here, '../src/characters.json');

const slug = name =>
  name
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// The legacy file uses both {En} and {E} for energy — a hand-entry inconsistency.
const DAMAGE_TYPES = {
  '{Ph}': 'physical',
  '{P}': 'physical',
  '{En}': 'energy',
  '{E}': 'energy',
  '{My}': 'mystic',
  '{M}': 'mystic',
};

const MOVEMENT = {
  '{S}': 'S',
  '{M}': 'M',
  '{L}': 'L',
  short: 'S',
  medium: 'M',
  long: 'L',
};

const SUPERPOWER_TYPES = {
  activated: 'active',
  active: 'active',
  reaction: 'reactive',
  reactive: 'reactive',
  passive: 'passive',
  innate: 'innate',
  affiliation: 'affiliation',
  leadership: 'leadership',
};

const warnings = [];

function movement(raw, who) {
  const key = String(raw ?? '').trim();
  const mapped = MOVEMENT[key] ?? MOVEMENT[key.toLowerCase()];
  if (!mapped) {
    warnings.push(`${who}: unrecognized movement "${raw}", defaulting to M`);
    return 'M';
  }
  return mapped;
}

function damageType(raw, who) {
  const mapped = DAMAGE_TYPES[String(raw ?? '').trim()];
  if (!mapped) {
    warnings.push(`${who}: unrecognized damage type "${raw}", defaulting to physical`);
    return 'physical';
  }
  return mapped;
}

function superpowerType(raw, who) {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase();
  const mapped = SUPERPOWER_TYPES[key];
  if (!mapped) {
    warnings.push(`${who}: unrecognized superpower type "${raw}", defaulting to passive`);
    return 'passive';
  }
  return mapped;
}

/** Collapse Attack1..Attack4 into an array, dropping nulls. */
function collectAttacks(block, who) {
  const out = [];
  for (let i = 1; i <= 4; i++) {
    const raw = block[`Attack${i}`];
    if (!raw) continue;
    out.push({
      name: raw.Name,
      type: damageType(raw.Type, `${who} attack ${i}`),
      range: Math.max(1, Math.min(5, raw.Range ?? 1)),
      dice: raw.Weight ?? 0,
      cost: raw.Cost ?? 0,
      text: [raw.Effect1, raw.Effect2].filter(Boolean),
    });
  }
  return out;
}

/** Collapse Superpower1..Superpower6 into an array, dropping nulls. */
function collectSuperpowers(block, who) {
  const out = [];
  for (let i = 1; i <= 6; i++) {
    const raw = block[`Superpower${i}`];
    if (!raw) continue;
    out.push({
      name: raw.Name,
      type: superpowerType(raw.Type, `${who} superpower ${i}`),
      cost: raw.Cost ?? 0,
      text: raw.Effect ?? '',
    });
  }
  return out;
}

function statBlock(block, who) {
  return {
    cardImage: block.CardImage ?? null,
    stamina: block.HP ?? 1,
    movement: movement(block.Movement, who),
    size: block.Size ?? 2,
    defense: {
      physical: block.PhysicalDefense ?? 0,
      energy: block.EnergyDefense ?? 0,
      mystic: block.MysticDefense ?? 0,
    },
    attacks: collectAttacks(block, who),
    superpowers: collectSuperpowers(block, who),
  };
}

const legacy = JSON.parse(readFileSync(SOURCE, 'utf8'));

const characters = (legacy.Characters ?? []).map(c => {
  const name = c.Name;
  const alterEgo = c['Alter Ego'];
  return {
    id: slug(name),
    name,
    // The prototype repeated the name in Alter Ego when a character has none.
    alterEgo: alterEgo && alterEgo !== name ? alterEgo : null,
    affiliations: c.Affiliations ?? [],
    cp: c.CP ?? 0,
    threat: c.Cost ?? 0,
    baseMm: 40,
    healthy: statBlock(c.Healthy ?? {}, `${name} healthy`),
    injured: statBlock(c.Injured ?? {}, `${name} injured`),
    source: 'legacy-import',
    verified: false,
  };
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ characters }, null, 2) + '\n');

console.log(`Imported ${characters.length} characters → ${OUT}`);
console.log(`Tactics in source: ${(legacy.Tactics ?? []).length}`);
console.log(`Objectives in source: ${(legacy.Objectives ?? []).length}`);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  - ${w}`);
}
