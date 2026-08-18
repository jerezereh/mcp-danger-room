/**
 * A character's card, laid out like the printed one.
 *
 * Landscape, with the identity and stat box in a left rail and the attacks and
 * superpowers as full-width bars on the right — the same arrangement as the
 * physical card, so a player who knows the card can find a value in the same
 * place. Each side of the card gets its own panel, because that is how the
 * cards are: healthy on one face, injured on the other.
 *
 * The rendered data is primary and the scan is the reference. Data is
 * searchable, themeable and is what the engine acts on, so a discrepancy
 * between what you read and what the rules do becomes impossible rather than
 * merely unlikely. The scan sits beside it because everything here is imported
 * and only one record is human-verified.
 */

import { useState } from 'react';
import type { Attack, Character, PowerCost, StatBlock, Superpower } from '@danger-room/data';

import { CardText } from './CardText.js';
import { Glyph } from './Glyph.js';

/**
 * "X" is a variable cost, not a free power — it must never render as absent.
 * A numeric 0 genuinely means free and stays hidden.
 */
function costLabel(cost: PowerCost): string | null {
  if (cost === 'X') return 'X';
  return cost > 0 ? String(cost) : null;
}

/** Beam and Area print their prefix on the card; keep it visible here too. */
function rangeLabel(attack: Attack): string {
  const prefix = attack.shape === 'beam' ? 'B' : attack.shape === 'area' ? 'A' : '';
  return `${prefix}${attack.range}`;
}

/** Attack types share their icons with the defenses — as they do on the card. */
const ATTACK_GLYPH = { physical: 'physical', energy: 'energy', mystic: 'mystic' } as const;

const POWER_GLYPH: Record<Superpower['type'], string> = {
  active: 'active',
  reactive: 'reactive',
  innate: 'innate',
  leadership: 'leadership',
};

/** One stat: its icon, then its value, as the card prints them. */
function Stat({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-1.5">
      <Glyph name={icon} label={label} className="h-6 w-6 shrink-0" />
      <span className="min-w-6 rounded bg-slate-900/70 px-1.5 py-0.5 text-center text-sm font-semibold tabular-nums text-slate-100">
        {value}
      </span>
    </div>
  );
}

/**
 * The stat box, in the printed arrangement: three defenses across the top,
 * then stamina and threat, then size and movement.
 */
function StatBox({ block, threat }: { block: StatBlock; threat: number }) {
  return (
    <div className="space-y-1.5 rounded-lg bg-slate-800/60 p-2">
      <div className="flex flex-wrap gap-2">
        <Stat icon="physical" label="Physical defense" value={block.defense.physical} />
        <Stat icon="energy" label="Energy defense" value={block.defense.energy} />
        <Stat icon="mystic" label="Mystic defense" value={block.defense.mystic} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Stat icon="stamina" label="Stamina" value={block.stamina} />
        <Stat icon="threat" label="Threat" value={threat} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Stat icon="size" label="Size" value={block.size} />
        <Stat icon="movement" label="Movement" value={block.movement} />
      </div>
    </div>
  );
}

/** An attack or superpower bar: type icon, name, then the values at the right. */
function Bar({
  icon,
  label,
  name,
  values,
  children,
}: {
  icon: string;
  label: string;
  name: string;
  values: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 rounded-full bg-slate-900/80 py-1 pl-1 pr-3">
        <Glyph name={icon} label={label} className="h-6 w-6 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold uppercase tracking-wide text-slate-100">
          {name}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-slate-300">
          {values}
        </span>
      </div>
      {children && <div className="space-y-1 px-3 pt-1">{children}</div>}
    </div>
  );
}

function Value({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1" title={label}>
      <Glyph name={icon} label={label} className="h-4 w-4" />
      {children}
    </span>
  );
}

function Side({
  block,
  threat,
  title,
  scan,
  alt,
  onScanMissing,
}: {
  block: StatBlock;
  threat: number;
  title: string;
  scan: string | null;
  alt: string;
  onScanMissing: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-surface-border bg-surface-raised">
      <h4 className="border-b border-surface-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h4>

      {/*
        The printed card gives roughly a quarter of its width to the stat rail
        and the rest to the abilities; this follows it, and collapses to a
        single column when the panel is too narrow for two.
      */}
      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(150px,0.28fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <StatBox block={block} threat={threat} />
          <CardScan file={scan} alt={alt} onMissing={onScanMissing} />
        </div>

        <div className="min-w-0 space-y-2">
          {block.attacks.map(attack => (
            <Bar
              key={attack.name}
              icon={ATTACK_GLYPH[attack.type]}
              label={`${attack.type} attack`}
              name={attack.name}
              values={
                <>
                  <Value icon="range" label="Range">
                    {rangeLabel(attack)}
                  </Value>
                  <Value icon="strength" label="Dice">
                    {attack.dice}
                  </Value>
                  <Value icon="power" label="Power cost">
                    {costLabel(attack.cost) ?? 0}
                  </Value>
                </>
              }
            >
              {attack.text.map((line, i) => (
                <CardText key={i} text={line} bullet />
              ))}
            </Bar>
          ))}

          {block.superpowers.map(power => {
            const cost = costLabel(power.cost);
            return (
              <Bar
                key={power.name}
                icon={POWER_GLYPH[power.type]}
                label={`${power.type} superpower`}
                name={power.name}
                values={
                  cost !== null ? (
                    <Value icon="power" label="Power cost">
                      {cost}
                    </Value>
                  ) : null
                }
              >
                {power.text && <CardText text={power.text} />}
              </Bar>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * A card scan, if one has been fetched.
 *
 * The images are ~410MB for the full corpus, so they are gitignored and
 * fetched on demand — a fresh checkout has none. Missing scans resolve to
 * nothing rather than a broken image.
 */
function CardScan({
  file,
  alt,
  onMissing,
}: {
  file: string | null;
  alt: string;
  onMissing: () => void;
}) {
  const [failed, setFailed] = useState(false);
  if (!file || failed) return null;

  const href = `/cards/${encodeURIComponent(file)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded border border-surface-border transition hover:border-slate-500"
      title="Open the full-size scan"
    >
      <img
        src={href}
        alt={alt}
        loading="lazy"
        onError={() => {
          setFailed(true);
          onMissing();
        }}
        className="w-full"
      />
    </a>
  );
}

export function CharacterCard({ character }: { character: Character }) {
  const [scansMissing, setScansMissing] = useState(false);

  return (
    <article className="space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-bold uppercase tracking-wide text-slate-100">
            {character.name}
          </h3>
          {character.alterEgo && (
            <p className="truncate text-sm text-slate-500">{character.alterEgo}</p>
          )}
          <p className="mt-1 text-xs text-slate-400">{character.affiliations.join(' · ')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-right">
          <div className="flex items-center gap-1.5">
            <Glyph name="threat" label="Threat" className="h-6 w-6" />
            <span className="text-lg font-semibold tabular-nums text-slate-100">
              {character.threat}
            </span>
          </div>
          {character.packCode && (
            <div className="rounded bg-surface-raised px-2 py-1">
              <div className="text-[10px] uppercase text-slate-500">Pack</div>
              <div className="text-sm font-semibold text-slate-200">{character.packCode}</div>
            </div>
          )}
        </div>
      </header>

      {/*
        Errata is shown prominently because it explains a discrepancy the player
        would otherwise hit at the table: the printed card in their hand says one
        thing and these stats say another. Without this the app just looks wrong.
      */}
      {character.errata && (
        <div className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1.5">
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
            Errata — differs from the printed card
          </div>
          <p className="whitespace-pre-line text-xs leading-relaxed text-sky-100/80">
            {character.errata}
          </p>
        </div>
      )}

      {!character.verified && (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
          Unverified data — imported, not yet checked against the printed card.
        </p>
      )}

      {scansMissing && (
        <p className="rounded border border-surface-border bg-surface px-2 py-1.5 text-xs text-slate-500">
          Card scans not downloaded.{' '}
          <code className="text-slate-400">npm run fetch:images --workspace @danger-room/data</code>
        </p>
      )}

      <Side
        block={character.healthy}
        threat={character.threat}
        title="Healthy"
        scan={character.healthy.cardImage}
        alt={`${character.name}, healthy side`}
        onScanMissing={() => setScansMissing(true)}
      />
      <Side
        block={character.injured}
        threat={character.threat}
        title="Injured"
        scan={character.injured.cardImage}
        alt={`${character.name}, injured side`}
        onScanMissing={() => setScansMissing(true)}
      />
    </article>
  );
}
