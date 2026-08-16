/**
 * Roster builder — the first milestone.
 *
 * Deliberately the first real screen, because it needs no board, no server, and
 * no rules engine, and it is the feature the project was started for. It also
 * forces the card data into shape early, which is the schedule risk that
 * matters most.
 */

import { useMemo, useState } from 'react';
import {
  DEFAULT_ROSTER_SIZE,
  characters as allCharacters,
  enumerateSquads,
  indexCharacters,
  validateRoster,
} from '@danger-room/data';

import { CharacterCard } from './CharacterCard.js';

export function RosterBuilder() {
  const [rosterIds, setRosterIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threatLimit, setThreatLimit] = useState(17);
  const [query, setQuery] = useState('');

  const lookup = useMemo(() => indexCharacters(allCharacters), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCharacters;
    return allCharacters.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        c.affiliations.some(a => a.toLowerCase().includes(q)),
    );
  }, [query]);

  const roster = useMemo(
    () => ({ id: 'draft', name: 'Draft roster', characterIds: rosterIds }),
    [rosterIds],
  );

  const validation = useMemo(
    () => validateRoster(roster, lookup, DEFAULT_ROSTER_SIZE),
    [roster, lookup],
  );

  // The actual playtesting question: what can this roster field at this threat?
  const squads = useMemo(
    () => enumerateSquads(roster, lookup, threatLimit),
    [roster, lookup, threatLimit],
  );

  const selected = selectedId ? lookup.get(selectedId) : undefined;

  const toggle = (id: string) =>
    setRosterIds(current =>
      current.includes(id) ? current.filter(x => x !== id) : [...current, id],
    );

  return (
    <div className="grid h-full grid-cols-[1fr_360px_400px] gap-4 overflow-hidden p-4">
      {/* Card pool */}
      <section className="flex flex-col overflow-hidden rounded-lg border border-surface-border bg-surface-raised">
        <div className="border-b border-surface-border p-3">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name or affiliation…"
            className="w-full rounded bg-surface px-3 py-2 text-sm text-slate-200 outline-none ring-accent/40 placeholder:text-slate-600 focus:ring-2"
          />
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-raised text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Affiliations</th>
                <th className="px-3 py-2 text-right font-medium">Threat</th>
                              </tr>
            </thead>
            <tbody>
              {filtered.map(character => {
                const inRoster = rosterIds.includes(character.id);
                return (
                  <tr
                    key={character.id}
                    onClick={() => setSelectedId(character.id)}
                    onDoubleClick={() => toggle(character.id)}
                    className={`cursor-pointer border-t border-surface-border/50 transition ${
                      selectedId === character.id ? 'bg-accent/15' : 'hover:bg-white/5'
                    } ${inRoster ? 'text-slate-500' : 'text-slate-200'}`}
                  >
                    <td className="px-3 py-2">{character.name}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {character.affiliations.join(', ')}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{character.threat}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-500">No characters match.</p>
          )}
        </div>

        <p className="border-t border-surface-border px-3 py-2 text-xs text-slate-500">
          {allCharacters.length} characters loaded · double-click to add
        </p>
      </section>

      {/* Roster + squad analysis */}
      <section className="flex flex-col gap-3 overflow-hidden">
        <div className="rounded-lg border border-surface-border bg-surface-raised p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Roster</h3>
            <span
              className={`text-xs tabular-nums ${
                validation.valid ? 'text-slate-400' : 'text-accent'
              }`}
            >
              {rosterIds.length} / {DEFAULT_ROSTER_SIZE} characters ·{' '}
              {validation.totals.threat} threat
            </span>
          </div>

          {rosterIds.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-600">
              Double-click characters to build a roster.
            </p>
          ) : (
            <ul className="space-y-1">
              {rosterIds.map(id => {
                const character = lookup.get(id);
                if (!character) return null;
                return (
                  <li
                    key={id}
                    className="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-white/5"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(id)}
                      className="truncate text-left text-slate-200"
                    >
                      {character.name}
                    </button>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                      <span className="tabular-nums">
                        {character.threat} threat
                      </span>
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        className="text-slate-600 hover:text-accent"
                        aria-label={`Remove ${character.name}`}
                      >
                        ×
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {validation.violations.map((v, i) => (
            <p key={i} className="mt-2 text-xs text-accent">
              {v.message}
            </p>
          ))}
        </div>

        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-surface-border bg-surface-raised p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Legal squads</h3>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Threat
              <input
                type="number"
                value={threatLimit}
                min={0}
                max={40}
                onChange={e => setThreatLimit(Number(e.target.value))}
                className="w-14 rounded bg-surface px-2 py-1 text-right tabular-nums text-slate-200 outline-none"
              />
            </label>
          </div>

          <p className="mb-2 text-xs text-slate-500">
            {squads.length} squad{squads.length === 1 ? '' : 's'} fieldable at {threatLimit} threat
          </p>

          <ul className="flex-1 space-y-1 overflow-auto text-xs">
            {squads.slice(0, 100).map((squad, i) => (
              <li key={i} className="rounded bg-surface px-2 py-1 text-slate-400">
                {squad.map(id => lookup.get(id)?.name ?? id).join(' · ')}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Detail */}
      <section className="overflow-auto rounded-lg border border-surface-border bg-surface p-3">
        {selected ? (
          <CharacterCard character={selected} />
        ) : (
          <p className="pt-8 text-center text-sm text-slate-600">
            Select a character to see its card.
          </p>
        )}
      </section>
    </div>
  );
}
