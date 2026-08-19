/**
 * House style for rules text.
 *
 * The sources disagree with themselves about capitalisation and emphasis: the
 * corpus arrived with 448 lowercase "turn" against 282 "Turn", 242 "advance"
 * against 120 "Advance", and not one bolded phase name anywhere. Cards print
 * these consistently, so the inconsistency is transcription noise rather than
 * anything the game intends, and it is worth fixing once here instead of in
 * every override.
 *
 * Applied after overrides, so hand-written corrections get the same treatment
 * as imported text and a correction never has to remember the conventions.
 */

/** Game terms the cards always capitalise. */
const TERMS = ['turn', 'activation', 'advance', 'advanced', 'advances', 'advancing'];

/**
 * Step names that can only ever be step names, so case does not matter: a
 * source that wrote "power phase" still meant the step.
 */
const PHASES = ['Activation Phase', 'Cleanup Phase', 'Power Phase'];

/**
 * Step names that are also ordinary verb phrases, so case is the only thing
 * separating them. "During the Modify Dice step" is a step; "cannot reroll or
 * modify dice in the defense roll" is prose, and bolding it would name a step
 * the sentence is not talking about. The corpus contains four of the latter.
 *
 * "Modify Opponent's Dice" is its own step rather than a variant of "Modify
 * Dice", and is listed so it is matched whole.
 */
const EXACT_PHRASES = ["Modify Opponent's Dice", 'Modify Dice'];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const longestFirst = (a: string, b: string) => b.length - a.length;

const TERM_RE = new RegExp(`\\b(${TERMS.join('|')})\\b`, 'g');

const PHASE_RE = new RegExp(`(${[...PHASES].sort(longestFirst).map(escape).join('|')})`, 'gi');
const CANONICAL = new Map(PHASES.map(p => [p.toLowerCase(), p]));
const EXACT_RE = new RegExp(
  `(${[...EXACT_PHRASES].sort(longestFirst).map(escape).join('|')})`,
  'g',
);

/*
 * Glyph tokens and existing bold runs are left alone.
 *
 * Without this, a phase inside an already-bold run would nest, and a term
 * inside a token would be rewritten into something the tokenizer no longer
 * accepts. Splitting on a capturing group puts the protected runs at odd
 * indices, so they pass through untouched.
 */
const PROTECTED = /(\{[A-Za-z?]+\}|<b>[\s\S]*?<\/b>)/g;

const mapPlain = (text: string, fn: (part: string) => string): string =>
  text
    .split(PROTECTED)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('');

/**
 * @param names Phrases to bold wherever they appear: the character's own name
 *   and the names of its abilities. Cards bold both, and it is what makes
 *   "make a Whistle While You Work attack" read as a reference rather than
 *   prose. Matched case-sensitively — an ability called "Flight" should not
 *   capture the word "flight" in a sentence.
 */
export function normalizeRulesText(text: string, names: readonly string[] = []): string {
  const cased = mapPlain(text, part => part.replace(TERM_RE, capitalize));

  // Phases before names, then re-split, so a name inside a freshly bolded
  // phase is already protected by the time names are matched.
  const withPhases = mapPlain(cased, part =>
    part
      .replace(PHASE_RE, match => `<b>${CANONICAL.get(match.toLowerCase()) ?? match}</b>`)
      .replace(EXACT_RE, '<b>$1</b>'),
  );

  // Short names are skipped: three letters will match inside ordinary words.
  const boldable = [...new Set(names.filter(n => n.length >= 4))].sort(longestFirst);
  if (boldable.length === 0) return withPhases;

  const nameRe = new RegExp(`(${boldable.map(escape).join('|')})`, 'g');
  return mapPlain(withPhases, part => part.replace(nameRe, '<b>$1</b>'));
}

/** Every name that should be bold inside one character's rules text. */
type Side = { attacks: { name: string }[]; superpowers: { name: string }[] };

export function boldableNames(character: {
  name: string;
  healthy: Side;
  injured: Side;
  forms?: { healthy: Side; injured: Side }[];
}): string[] {
  const names = new Set<string>([character.name]);
  const sides = [
    character.healthy,
    character.injured,
    ...(character.forms ?? []).flatMap(f => [f.healthy, f.injured]),
  ];
  for (const side of sides) {
    for (const a of side.attacks) names.add(a.name);
    for (const p of side.superpowers) names.add(p.name);
  }
  return [...names];
}
