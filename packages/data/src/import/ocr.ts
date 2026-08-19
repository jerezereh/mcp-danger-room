/**
 * OCR extractions as a merge source.
 *
 * The vision extractor covers what neither community source can: characters
 * released after BSData stopped updating, which have metadata but no rules
 * text anywhere.
 *
 * Deliberately the *lowest* precedence for everything. It reads the physical
 * card, which means it is blind to errata — a card printed before a stat change
 * shows the old value — and it is the only source that can hallucinate. So it
 * fills gaps and never overrides a curated source. For the 41 characters it was
 * run against, those gaps are total: no other source has their attacks or
 * superpowers at all.
 */

import type { Superpower } from '../schema.js';
import { linkBlankWord } from '../symbols.js';
import type { CharacterDraft } from './draft.js';
import type { ExtractedCard } from './extraction.js';

export interface ExtractionRecord {
  id: string;
  card: ExtractedCard;
}

export function ocrToDraft(record: ExtractionRecord): CharacterDraft {
  const { id, card } = record;

  /*
   * Migration shim for extractions taken before 'affiliation' was retired.
   *
   * The type no longer exists — what the model called an affiliation power is a
   * Leadership ability with a qualified name. Without this, extractions already
   * on disk fail validation and their characters drop out of the corpus, which
   * is a worse outcome than relabelling a value whose meaning is unambiguous.
   *
   * Delete once every extraction on disk postdates that change; the stale-file
   * warning in import-cards is what tells you when that is.
   */
  const superpowerType = (t: string): Superpower['type'] =>
    t === 'affiliation' ? 'leadership' : (t as Superpower['type']);

  const side = (s: ExtractedCard['healthy'], cardImage: string | null) => ({
    cardImage,
    stamina: s.stamina,
    movement: s.movement,
    size: s.size,
    defense: s.defense,
    // Safety net: the prompt asks for {BLANK}, but a spelled-out Blank that
    // slips through must not reach the corpus as prose.
    attacks: s.attacks.map(a => ({ ...a, text: a.text.map(linkBlankWord) })),
    superpowers: s.superpowers.map(p => ({
      ...p,
      type: superpowerType(p.type),
      text: linkBlankWord(p.text),
    })),
  });

  return {
    id,
    name: card.name,
    alterEgo: card.alterEgo,
    // Affiliations and threat are not on the card; they come from Jarvis and
    // Cerebro, and the extractor no longer asks for them.
    healthy: side(card.healthy, null),
    injured: side(card.injured, null),
    sources: ['ocr'],
  };
}
