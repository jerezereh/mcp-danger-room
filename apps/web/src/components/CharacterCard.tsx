/**
 * A character's full stat block, both sides.
 *
 * Rendered from data rather than shown as a card image. Images are still worth
 * having as a reference view, but a data-driven card is searchable, themeable,
 * readable at any size, and — critically — the thing the engine actually acts
 * on, so a discrepancy between what you read and what the rules do becomes
 * impossible rather than merely unlikely.
 */

import type { Character, StatBlock } from '@danger-room/data';

import { CardText } from './CardText.js';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center rounded bg-surface px-2 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-200">{value}</span>
    </div>
  );
}

function Side({ block, title }: { block: StatBlock; title: string }) {
  return (
    <section className="rounded-lg border border-surface-border bg-surface-raised p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h4>

      <div className="mb-3 grid grid-cols-6 gap-1">
        <Stat label="Sta" value={block.stamina} />
        <Stat label="Mov" value={block.movement} />
        <Stat label="Size" value={block.size} />
        <Stat label="Phy" value={block.defense.physical} />
        <Stat label="Eng" value={block.defense.energy} />
        <Stat label="Mys" value={block.defense.mystic} />
      </div>

      <div className="space-y-2">
        {block.attacks.map(attack => (
          <div key={attack.name} className="rounded border border-surface-border/60 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-100">{attack.name}</span>
              <span className="shrink-0 text-xs text-slate-400">
                {attack.type} · R{attack.range} · {attack.dice} dice
                {attack.cost > 0 ? ` · ${attack.cost} power` : ''}
              </span>
            </div>
            {attack.text.map((line, i) => (
              <CardText key={i} text={line} className="mt-1" />
            ))}
          </div>
        ))}

        {block.superpowers.map(power => (
          <div key={power.name} className="rounded border border-surface-border/60 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-100">{power.name}</span>
              <span className="shrink-0 text-xs text-slate-400">
                {power.type}
                {power.cost > 0 ? ` · ${power.cost} power` : ''}
              </span>
            </div>
            <CardText text={power.text} className="mt-1" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function CharacterCard({ character }: { character: Character }) {
  return (
    <article className="space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">{character.name}</h3>
          {character.alterEgo && (
            <p className="text-sm text-slate-500">{character.alterEgo}</p>
          )}
          <p className="mt-1 text-xs text-slate-400">{character.affiliations.join(' · ')}</p>
        </div>
        <div className="flex shrink-0 gap-2 text-right">
          <div className="rounded bg-surface-raised px-2 py-1">
            <div className="text-[10px] uppercase text-slate-500">Threat</div>
            <div className="text-sm font-semibold text-slate-200">{character.threat}</div>
          </div>
          <div className="rounded bg-surface-raised px-2 py-1">
            <div className="text-[10px] uppercase text-slate-500">CP</div>
            <div className="text-sm font-semibold text-slate-200">{character.cp}</div>
          </div>
        </div>
      </header>

      {!character.verified && (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
          Unverified data — imported, not yet checked against the printed card.
        </p>
      )}

      <Side block={character.healthy} title="Healthy" />
      <Side block={character.injured} title="Injured" />
    </article>
  );
}
