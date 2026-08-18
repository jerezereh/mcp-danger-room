/**
 * The OCR extraction contract.
 *
 * Deliberately narrower than `Character`: it asks the model only for what is
 * legible on the card. `id`, `packCode`, `cardImage`, `source` and `verified`
 * are things we already know, and asking a model to restate known facts invites
 * it to invent them.
 *
 * It *does* ask for name and stamina even though other sources supply them —
 * precisely so the two can be compared. Those are the cross-check that tells
 * you whether an extraction is trustworthy, and they only work as a check if
 * the model reads them independently. Both are plainly printed on the card, and
 * across 38 real extractions stamina disagreed exactly once.
 *
 * Affiliations and threat are deliberately absent. Affiliations are not on
 * character cards at all — they are set by the rules body. Threat was on the
 * schema initially and proved unreadable in practice: on 15 of 38 cards the
 * model reported it could not see a threat value and emitted a placeholder,
 * because a required field leaves it no way to say "not visible". Requiring a
 * field a model cannot read does not get you the value, it gets you a
 * confident guess.
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

import {
  CANONICAL_TOKENS,
  SYMBOL_GLYPHS,
  SYMBOL_LABELS,
  type SymbolKey,
} from '../symbols.js';

/** Mirrors `PowerCost` in schema.ts — a number, or "X" when the player chooses. */
const ExtractedCost = z.union([z.number().int().min(0), z.literal('X')]);

const ExtractedAttack = z.object({
  name: z.string().min(1),
  type: z.enum(['physical', 'energy', 'mystic']),
  range: z.union([z.number().int().min(1).max(5), z.literal('*')]),
  /** The B or A printed before the range. See schema.ts `AttackShape`. */
  shape: z.enum(['range', 'beam', 'area']),
  dice: z.number().int().min(0).max(12),
  cost: ExtractedCost,
  text: z.array(z.string()),
});

const ExtractedSuperpower = z.object({
  name: z.string().min(1),
  type: z.enum(['active', 'reactive', 'innate', 'leadership']),
  cost: ExtractedCost,
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
export function buildSystemPrompt({ symbolKeyImage = false } = {}): string {
  const keys = Object.keys(SYMBOL_LABELS) as SymbolKey[];
  const width = Math.max(...keys.map(k => CANONICAL_TOKENS[k].length));

  /*
   * With the key image attached, the prompt lists the tokens but not what they
   * look like. Describing a small icon in a sentence is what produced the
   * misreads this key exists to fix, and prose left alongside the picture could
   * only contradict it.
   */
  const glyphs = keys
    .map(
      key =>
        `  ${CANONICAL_TOKENS[key].padEnd(width)}  ${SYMBOL_LABELS[key]}` +
        (symbolKeyImage ? '' : `${' '.repeat(Math.max(1, 11 - SYMBOL_LABELS[key].length))}${SYMBOL_GLYPHS[key]}`),
    )
    .join('\n');

  const appearance = symbolKeyImage
    ? `The first image in this message is a key: every icon that appears on a
card, each labelled with the token to write for it. Match what you see on the
card against that key. It is the authority on what each icon looks like — if a
card icon does not match any cell in the key, say so in "notes" rather than
choosing the nearest one.`
    : `Three of these are one confusable cluster: Power, Hit and Threat. All three
radiate from a centre and all three have something dark at that centre, so the
centre will not tell them apart. The outline will:

  Power   long, even, sharply pointed spikes around a large round dark hole
  Hit     a jagged, uneven burst — shorter and rougher — around a small dot
  Threat  no spikes at all: a smooth unbroken circle, with the six lines cut
          across the disc rather than sticking out of it`;

  return `You transcribe Marvel: Crisis Protocol character cards into structured data.

You are given both sides of one character's card: the healthy side and the
injured side. Transcribe exactly what is printed. Do not infer, correct, or
complete values from your own knowledge of the game — if the card says a
Stamina of 6, report 6 even if you believe the character has 7.

## Symbols

Card text uses inline icons. Transcribe each one as its token below, preserving
its position in the sentence. Use these exact spellings and no others — never
invent a token, and never write the icon's name as a plain word instead.

${glyphs}

${appearance}

Position helps confirm. On an attack or superpower bar, the cost printed at the
right-hand end is always Power. An icon leading a bullet is always a dice
result, so it is Hit and never Power or Threat.

One result has no icon: Blank. Cards spell it out as the word "Blank" in the
sentence. Transcribe that word as {BLANK} — it is a die result like the others
and has to be readable as one, not left as prose.

Inline icons are printed as white glyphs inside a small black circular badge.
Read only the shape inside the badge. The badge is never part of the symbol —
in particular, a round badge does not make an icon the Range crosshair.

Colour is available in the stat box and on attack-type badges, but inline in
rules text every icon is white on black. So Energy and Wild cannot be told
apart by colour there, only by construction: Energy is a pinwheel of several
separate curved blades, like a camera shutter; Wild is one continuous coil
winding outward, like the @ sign. Count the strokes — several or one.

### Trigger icons

A bullet under an attack usually begins with one or more icons followed by a
trigger name — "{WILD} <b>Stun</b>:", "{CRIT} {HIT} <b>Ricochet</b>:". These
are always dice results, and always come from these five and nothing else:

  {CRIT}  {WILD}  {HIT}  {BLOCK}  {FAIL}

Across 720 such bullets in a reference corpus, no other symbol has ever
appeared in that position. So when you see icons leading a bullet, the
question is only *which* of those five, never whether it might be something
else. The same holds for an icon inside a sentence counting results, as in
"for each {WILD} in the attack roll".

Which of the five it is can only be read off the card. A trigger name does not
fix its icons — the same trigger takes different dice on different cards — and
no one of the five is common enough to be a safe default. Read them; do not
recall them and do not fall back on which one is usual.

### When you cannot tell

If an icon is genuinely not identifiable, transcribe it as {UNKNOWN} and say
what it looked like in "notes". Do not omit it — a dropped icon changes what
the rule says and leaves nothing behind to show that it happened. {UNKNOWN} is
collected automatically, so flagging one is cheap.

But prefer a considered reading to a flag when the position tells you the
answer, as it does for the five dice results above. {UNKNOWN} is for an icon
you cannot place at all, not for one you can narrow to a small set.

Bold trigger names (Pierce, Momentum, Cleave) stay as <b>Name</b>.

## The stat box

A panel at the top left, below the character name and alter ego, holds seven
values in three rows. Identify each by its icon, not by its position — the
icons are what disambiguate, and a value read off the wrong row is wrong with
nothing to catch it. The layout below is a guide to where to look:

  Row 1   red fist       Physical defense
          yellow swirl   Energy defense
          blue eye       Mystic defense
  Row 2   pulse / EKG    Stamina
          segmented disc Threat (a smooth circle cut into six segments — not
                         the Power star, whose edge is spiked)
  Row 3   I-beam         Size (1-5; 5 exists and is rare)
          triple chevron Movement (S, M or L)

The healthy and injured sides use the same layout. Only the colour differs —
teal on the healthy side, orange on the injured one — so do not read the tint
as meaning anything.

Those same three defense icons mark attack types: an attack led by the red fist
is physical, the yellow swirl energy, the blue eye mystic. If an attack's icon
does not match one of the three defense icons you just read, you have misread
one of them.

## Attacks

Each attack is one bar. Its type icon is at the left, its name on the bar, and
three values at the right, in this order: the range icon (a crosshair), the
Strength icon (a barbell) giving the number of dice, and the Power star giving
the cost.

The range value may carry a letter prefix, which is a rule and not decoration:

  4    ordinary attack, range 4      -> range 4, shape "range"
  B4   Beam, range 4                 -> range 4, shape "beam"
  A2   Area, size 2                  -> range 2, shape "area"
  A*   Area whose text defines it    -> range "*", shape "area"

Report the number in "range" and the prefix in "shape". Never drop the prefix
and never fold it into the number.

## Fields

- Attack "dice" is the number of dice in the attack pool — the value beside the
  barbell (Strength) icon.
- Superpower "type" is Active, Reactive, Innate or Leadership. The icon at the
  *left* head of the bar gives the type — four outward arrows for Active,
  lightning bolts for Reactive, an infinity sign for Innate, a solid
  five-pointed star for Leadership. Any cost is at the *right* end of the same
  bar, so which side an icon sits on tells you which of the two it is. Innate
  powers usually show no cost — report 0.
- There is no "affiliation" type. A Leadership ability is often named
  "Some Name (Affiliation: Hydra)", which qualifies when the Leadership
  applies; it is still Leadership. Affiliation itself is not printed on
  character cards at all.
- A cost printed as "X" is a variable cost: the player chooses how much Power to
  spend, and the rules text gives the limit ("spend up to 3"). Report the string
  "X", never 0 — 0 would mean the power is free, which is a different rule.
- List each superpower as its own entry, including keyword-only Innate powers
  that carry no rules text (Flight, Peerless, Gem Bearer, Martial Artist, and
  similar). These are often printed together on one line; they are still
  separate superpowers. Never combine several into one entry, and never leave
  an entry's text empty because you merged the names into its title.
- "alterEgo" is the civilian name printed under the character name. For some
  characters it is the same text as the character name — that is correct, so
  transcribe it rather than treating the repetition as absent. Use null only
  when the card prints no alter ego at all.
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

/**
 * Trigger prefixes that contain a symbol no trigger can carry.
 *
 * A bullet's leading icons are always dice results. Anything else there is
 * definitively a misread, so this needs no reference data and no second model
 * call — it is a type error in the transcription.
 *
 * It catches the extractor's two standing confusions, both of which produce
 * legal-looking tokens: the Wild coil read as Energy or as Range, and the Hit
 * burst read as the Power star. Every one of those was invisible before,
 * because a wrong-but-valid token looks exactly like a right one.
 */
const DICE_TOKENS = new Set(['CRIT', 'WILD', 'HIT', 'BLOCK', 'FAIL']);

export interface TriggerProblem {
  readonly side: 'healthy' | 'injured';
  readonly attack: string;
  readonly text: string;
  /** The tokens that cannot appear before a trigger name. */
  readonly offenders: string[];
}

export function checkTriggerIcons(card: ExtractedCard): TriggerProblem[] {
  const out: TriggerProblem[] = [];

  for (const side of ['healthy', 'injured'] as const) {
    for (const attack of card[side].attacks) {
      for (const text of attack.text) {
        const lead = text.match(/^((?:\{[A-Za-z]+\}\s*)+)\s*(?:<b>)?[A-Za-z][A-Za-z '!-]{1,24}?(?:<\/b>)?\s*:/);
        if (!lead) continue;

        const tokens = [...(lead[1] as string).matchAll(/\{([A-Za-z]+)\}/g)].map(m => m[1] as string);
        // {UNKNOWN} is an honest flag, not a misread — it is reported elsewhere.
        const offenders = tokens.filter(t => !DICE_TOKENS.has(t) && t !== 'UNKNOWN');
        if (offenders.length > 0) out.push({ side, attack: attack.name, text, offenders });
      }
    }
  }
  return out;
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
 * extraction that agrees on name, threat and stamina probably got the rules
 * text right too, and one that disagrees needs a human. Cheap, independent, and
 * it needs no second model call.
 */
export function crossCheck(
  extracted: ExtractedCard,
  known: {
    name?: string;
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
  return out;
}
