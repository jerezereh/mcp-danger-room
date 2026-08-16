/**
 * Character identity across sources.
 *
 * The three sources spell the same character differently — Cerebro says
 * "Abomination", BSData says "ABOMINATION (Emil Blonsky)". The slug is what
 * joins them, so it has to discard everything that varies: case, punctuation,
 * and the parenthesised alter ego BSData appends to most names.
 *
 * Deliberately not clever. A fuzzy matcher would silently merge two different
 * characters, which is far worse than leaving one unmatched for a human.
 */

export function slugify(name: string): string {
  return name
    .replace(/\(.*?\)/g, '') // drop "(Emil Blonsky)"
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * A slug that includes the alter ego, for characters a bare name cannot
 * identify.
 *
 * The name alone is genuinely ambiguous in this game: both sources list two
 * characters called "Captain America" (Steve Rogers and Sam Wilson) and two
 * called "Spider-Man" (Peter Parker and Miles Morales). They are different
 * characters with different stat lines.
 *
 * This is *not* the default key, because the two sources spell alter egos
 * inconsistently — using it everywhere would break the join for the ~99% of
 * characters whose name is already unique. The merge applies it only within an
 * ambiguous group.
 */
export function qualifiedSlug(name: string, alterEgo: string | null | undefined): string {
  const base = slugify(name);
  const ego = alterEgo ? slugify(alterEgo) : '';
  return ego && ego !== base ? `${base}-${ego}` : base;
}

/** Split BSData's "ANGELA (Aldrif Odinsdottir)" into its two parts. */
export function splitName(raw: string): { name: string; alterEgo: string | null } {
  const match = raw.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!match) return { name: raw.trim(), alterEgo: null };

  const [, name = '', alterEgo = ''] = match;
  return { name: name.trim(), alterEgo: alterEgo.trim() || null };
}
