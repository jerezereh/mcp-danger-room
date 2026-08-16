/**
 * The OCR extraction contract.
 *
 * Deliberately narrower than `Character`: it asks the model only for what is
 * legible on the card. `id`, `packCode`, `cardImage`, `source` and `verified`
 * are things we already know, and asking a model to restate known facts invites
 * it to invent them.
 *
 * It *does* ask for name, threat, affiliations and stamina even though Cerebro
 * supplies those — precisely so the two can be compared. Those four fields are
 * the cross-check that tells you whether an extraction is trustworthy, and they
 * only work as a check if the model reads them independently.
 */

/*
 * Built with `zod/v4`, unlike the rest of the package.
 *
 * The SDK's `zodOutputFormat` — which turns a schema into the JSON Schema the
 * API constrains generation with — runs zod v4's JSON-Schema generator and
 * throws on a v3 schema object. zod 3.25 ships v4 under this subpath, so the
 * extraction contract uses it while `schema.ts` stays on v3.
 *
 * That means the attack and superpower shapes are declared twice. The
 * duplication is guarded by a test asserting a real imported character
 * validates as an extraction — if the two ever drift, extractions stop being
 * mergeable into the corpus and that test fails first.
 */
import { z } from 'zod/v4';

import { CANONICAL_TOKENS, SYMBOL_LABELS, type SymbolKey } from '../symbols.js';

const ExtractedAttack = z.object({
  name: z.string().min(1),
  type: z.enum(['physical', 'energy', 'mystic']),
  range: z.number().int().min(1).max(5),
  dice: z.number().int().min(0).max(12),
  cost: z.number().int().min(0),
  text: z.array(z.string()),
});

const ExtractedSuperpower = z.object({
  name: z.string().min(1),
  type: z.enum(['active', 'reactive', 'passive', 'innate', 'affiliation', 'leadership']),
  cost: z.number().int().min(0),
  text: z.string(),
});

export const ExtractedStatBlock = z.object({
  stamina: z.number().int().min(1).max(20),
  movement: z.enum(['S', 'M', 'L']),
  size: z.number().int().min(1).max(5),
  defense: z.object({
    physical: z.number().int().min(0).max(10),
    energy: z.number().int().min(0).max(10),
    mystic: z.number().int().min(0).max(10),
  }),
  attacks: z.array(ExtractedAttack),
  superpowers: z.array(ExtractedSuperpower),
});

export const ExtractedCard = z.object({
  name: z.string().min(1),
  alterEgo: z.string().nullable(),
  affiliations: z.array(z.string()),
  threat: z.number().int().min(0).max(20),
  healthy: ExtractedStatBlock,
  injured: ExtractedStatBlock,
  /** The model's own assessment, so unreadable scans can be triaged. */
  legibility: z.enum(['clear', 'partial', 'poor']),
  notes: z.string(),
});

export type ExtractedCard = z.infer<typeof ExtractedCard>;

/**
 * The system prompt.
 *
 * The symbol vocabulary is generated from the canonical table rather than
 * hand-written, so it cannot drift from what the tokenizer accepts — a glyph
 * the prompt teaches but the tokenizer rejects would render as an error in the
 * UI for every card that used it.
 */
export function buildSystemPrompt(): string {
  const glyphs = (Object.keys(SYMBOL_LABELS) as SymbolKey[])
    .map(key => `  ${CANONICAL_TOKENS[key]} = ${SYMBOL_LABELS[key]}`)
    .join('\n');

  return `You transcribe Marvel: Crisis Protocol character cards into structured data.

You are given both sides of one character's card: the healthy side and the
injured side. Transcribe exactly what is printed. Do not infer, correct, or
complete values from your own knowledge of the game — if the card says a
Stamina of 6, report 6 even if you believe the character has 7.

## Symbols

Card text uses inline icons. Transcribe each one as its token below, preserving
its position in the sentence. Use these exact spellings and no others:

${glyphs}

Bold trigger names (Pierce, Momentum, Cleave) stay as <b>Name</b>.

## Fields

- Attack "dice" is the number of dice in the attack pool, printed on the card
  as the attack's strength or weight.
- Attack "range" is the range band 1-5. Melee attacks are range 1.
- Superpower "type" is Active, Reactive, Innate, Leadership, or Affiliation as
  labelled on the card. Innate powers usually show no cost — report cost 0.
- "movement" is the speed template: S (short), M (medium), or L (long).
- Both sides of the card share the same attacks and superpowers unless the
  injured side prints a different set. If a side is not legible, still return
  your best reading and lower "legibility".

## Honesty

Set "legibility" to "clear" only when you could read every stat and every line
of rules text. Use "partial" when some text was cut off, blurred, or obscured,
and "poor" when substantial content was unreadable. Put anything you were
unsure about in "notes" — a wrong value reported confidently is far worse than
a flagged uncertainty, because nothing downstream will catch it.`;
}

export interface CrossCheck {
  readonly field: string;
  readonly extracted: unknown;
  readonly known: unknown;
}

/**
 * Compare an extraction against what Cerebro already told us.
 *
 * This is the whole reason the model is asked to read fields we know: an
 * extraction that agrees on name, threat, affiliations and stamina probably got
 * the rules text right too, and one that disagrees needs a human. Cheap,
 * independent, and it needs no second model call.
 */
export function crossCheck(
  extracted: ExtractedCard,
  known: {
    name?: string;
    threat?: number;
    affiliations?: string[];
    healthyStamina?: number;
    injuredStamina?: number;
  },
): CrossCheck[] {
  const out: CrossCheck[] = [];

  const norm = (s: string) => s.trim().toLowerCase();

  if (known.name && norm(known.name) !== norm(extracted.name)) {
    out.push({ field: 'name', extracted: extracted.name, known: known.name });
  }
  if (known.threat !== undefined && known.threat !== extracted.threat) {
    out.push({ field: 'threat', extracted: extracted.threat, known: known.threat });
  }
  if (known.healthyStamina !== undefined && known.healthyStamina !== extracted.healthy.stamina) {
    out.push({
      field: 'healthy.stamina',
      extracted: extracted.healthy.stamina,
      known: known.healthyStamina,
    });
  }
  if (known.injuredStamina !== undefined && known.injuredStamina !== extracted.injured.stamina) {
    out.push({
      field: 'injured.stamina',
      extracted: extracted.injured.stamina,
      known: known.injuredStamina,
    });
  }
  if (known.affiliations && known.affiliations.length > 0) {
    const a = new Set(known.affiliations.map(norm));
    const b = new Set(extracted.affiliations.map(norm));
    const same = a.size === b.size && [...a].every(x => b.has(x));
    if (!same) {
      out.push({
        field: 'affiliations',
        extracted: extracted.affiliations,
        known: known.affiliations,
      });
    }
  }

  return out;
}
