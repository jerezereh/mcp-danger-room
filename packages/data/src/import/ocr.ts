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

import type { CharacterDraft } from './draft.js';
import type { ExtractedCard } from './extraction.js';

export interface ExtractionRecord {
  id: string;
  card: ExtractedCard;
}

export function ocrToDraft(record: ExtractionRecord): CharacterDraft {
  const { id, card } = record;

  const side = (s: ExtractedCard['healthy'], cardImage: string | null) => ({
    cardImage,
    stamina: s.stamina,
    movement: s.movement,
    size: s.size,
    defense: s.defense,
    attacks: s.attacks,
    superpowers: s.superpowers,
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
