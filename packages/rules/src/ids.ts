/**
 * Branded identifiers.
 *
 * The distinction that matters most: a CharacterId names a *definition*
 * ("amazing-spider-man", immutable card data) while a ModelId names an
 * *instance on the table* (this particular Spider-Man, at these coordinates,
 * with this much damage). The old prototype conflated the two by storing
 * rosters as arrays of name strings, which left per-model state nowhere to
 * live and made duplicate characters impossible.
 */

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type CharacterId = Brand<string, 'CharacterId'>;
export type ModelId = Brand<string, 'ModelId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type CardId = Brand<string, 'CardId'>;

export const characterId = (raw: string) => raw as CharacterId;
export const modelId = (raw: string) => raw as ModelId;
export const playerId = (raw: string) => raw as PlayerId;
export const cardId = (raw: string) => raw as CardId;
