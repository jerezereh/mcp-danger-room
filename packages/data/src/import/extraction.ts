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
- List each superpower as its own entry, including keyword-only Innate powers
  that carry no rules text (Flight, Peerless, Gem Bearer, Martial Artist, and
  similar). These are often printed together on one line; they are still
  separate superpowers. Never combine several into one entry, and never leave
  an entry's text empty because you merged the names into its title.
- "alterEgo" is the civilian or secondary name printed under the character
  name. If the card shows no separate alter ego, or it simply repeats the
  character name, use null.
- "affiliations" are the affiliation icons or names on the card. Some scans
  crop or obscure them — return an empty list rather than guessing, and say so
  in "notes".
- "movement" is the speed template: S (short), M (medium), or L (long).
- Both sides of the card share the same attacks and superpowers unless the
  injured side prints a different set. If a side is not legible, still return
  your best reading and lower "legibility".

## Errata

Some cards were revised after printing. Transcribe what is physically on the
card in front of you, not what you believe the current official value to be —
reconciling printed against current is handled downstream, and it can only work
if your reading is faithful to the card.

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
  /**
   * True when errata accounts for the difference — informational, not a
   * problem. A scan of a pre-errata card legitimately shows the old value.
   */
  readonly explained?: boolean;
  readonly note?: string;
}

/**
 * Pull the before/after stamina out of an errata note.
 *
 * The format is consistent across the 136 characters that have one:
 * "Stamina change 6/6 to 7/6", occasionally "changed", sometimes followed by
 * other revisions in the same paragraph.
 *
 * Worth parsing rather than merely detecting, because it converts the check
 * from "ignore stamina when errata exists" into something stronger: the model's
 * reading must match either the printed value or the current one. A reading of
 * 9 on a card errata'd from 6 to 7 is still caught.
 */
export function parseStaminaErrata(
  errata: string | null | undefined,
): { printed: [number, number]; current: [number, number] } | null {
  if (!errata) return null;

  // Both sides are "N" or "N/N": single-sided characters (Hulkbuster,
  // She-Hulk) write one number, and She-Hulk mixes the two forms because the
  // errata gave her an injured side she did not previously have.
  const match = errata.match(
    /stamina\s+chang\w*\s+(\d+(?:\s*\/\s*\d+)?)\s+to\s+(\d+(?:\s*\/\s*\d+)?)/i,
  );
  if (!match) return null;

  const pair = (raw: string | undefined): [number, number] | null => {
    if (!raw) return null;
    const parts = raw.split('/').map(n => Number(n.trim()));
    const [a, b] = parts;
    if (a === undefined || !Number.isFinite(a)) return null;
    // A single value applies to both sides.
    return [a, b !== undefined && Number.isFinite(b) ? b : a];
  };

  const printed = pair(match[1]);
  const current = pair(match[2]);
  return printed && current ? { printed, current } : null;
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
    /** Errata text, so a pre-errata scan is not mistaken for a misread. */
    errata?: string | null;
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

  /*
   * Stamina needs errata awareness, or every errata'd character reports a
   * false positive.
   *
   * The corpus carries *current* stamina, but the scan is of a physical card —
   * which for 136 characters was printed before the change. Ancient One reads 6
   * on the card and is 7 in play. Flagging that as a misread would bury the
   * genuine ones.
   *
   * Either value is acceptable: the printed one (an original card) or the
   * current one (a reprint). Anything else is still a real misread.
   */
  const staminaErrata = parseStaminaErrata(known.errata);

  const checkStamina = (
    field: 'healthy.stamina' | 'injured.stamina',
    read: number,
    current: number | undefined,
    index: 0 | 1,
  ) => {
    if (current === undefined || read === current) return;

    const printed = staminaErrata?.printed[index];
    if (printed !== undefined && read === printed) {
      out.push({
        field,
        extracted: read,
        known: current,
        explained: true,
        note: `card was printed ${printed}, errata'd to ${current} — scan is pre-errata`,
      });
      return;
    }

    out.push({ field, extracted: read, known: current });
  };

  checkStamina('healthy.stamina', extracted.healthy.stamina, known.healthyStamina, 0);
  checkStamina('injured.stamina', extracted.injured.stamina, known.injuredStamina, 1);
  /*
   * An empty affiliation list means the model could not see them — scans often
   * crop the icons — not that the character has none. Treating that as a
   * disagreement forces review on cards that were read correctly, and we get
   * affiliations from Jarvis and Cerebro anyway.
   */
  if (
    known.affiliations &&
    known.affiliations.length > 0 &&
    extracted.affiliations.length > 0
  ) {
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
