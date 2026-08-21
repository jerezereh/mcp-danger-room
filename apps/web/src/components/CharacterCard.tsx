/**
 * A character's card, laid out like the printed one.
 *
 * Landscape, with the identity and stat box in a left rail and the attacks and
 * superpowers as full-width bars on the right — the same arrangement as the
 * physical card, so a player who knows the card can find a value in the same
 * place.
 *
 * Six characters transform, and print a second full card for the other mode.
 * Those get a mode selector beside the side selector, so Ant-Man is four
 * cards — Normal and Tiny, each healthy and injured — reached from one place.
 *
 * One side at a time, and the card flips. A physical card has a front and a
 * back; showing both at once is a thing only software does, and it doubles the
 * height of the tallest element on the screen. Clicking the card turns it over
 * — the behaviour jarvis-protocol.com uses — and every printed value turns
 * with it, so the stats on screen always describe the face you are looking
 * at.
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

function Value({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
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
  scan,
  alt,
  onFlip,
  onScanMissing,
}: {
  block: StatBlock;
  threat: number;
  scan: string | null;
  alt: string;
  onFlip: () => void;
  onScanMissing: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-surface-border bg-surface-raised">
      {/*
        The printed card gives roughly a quarter of its width to the stat rail
        and the rest to the abilities; this follows it, and collapses to a
        single column when the panel is too narrow for two.
      */}
      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(150px,0.28fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <StatBox block={block} threat={threat} />
          <CardScan file={scan} alt={alt} onFlip={onFlip} onMissing={onScanMissing} />
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
  onFlip,
  onMissing,
}: {
  file: string | null;
  alt: string;
  onFlip: () => void;
  onMissing: () => void;
}) {
  /*
   * Which scans failed, not whether one did.
   *
   * This component stays mounted while the card flips and while another
   * character is selected — only `file` changes. A single boolean meant the
   * first missing scan hid every scan afterwards for the life of the
   * component, including ones that exist.
   */
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  if (!file || failed.has(file)) return null;

  const href = `/cards/${encodeURIComponent(file)}`;
  return (
    <div className="group relative">
      {/*
        A button, not a bare click handler on the image: turning the card over
        is an action, and it should be reachable from the keyboard like one.
      */}
      <button
        type="button"
        onClick={onFlip}
        title="Turn the card over"
        className="block w-full overflow-hidden rounded border border-surface-border transition hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/60"
      >
        <img
          src={href}
          alt={alt}
          loading="lazy"
          onError={() => {
            setFailed(prev => new Set(prev).add(file));
            onMissing();
          }}
          className="w-full"
        />
      </button>

      {/* Clicking flips, so opening the full scan needs its own affordance. */}
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title="Open the full-size scan"
        className="absolute right-1 top-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[11px] text-slate-300 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
      >
        ↗
      </a>
    </div>
  );
}

export function CharacterCard({ character }: { character: Character }) {
  const [scansMissing, setScansMissing] = useState(false);
  const [side, setSide] = useState<'healthy' | 'injured'>('healthy');
  const [mode, setMode] = useState(0);
  const flip = () => setSide(s => (s === 'healthy' ? 'injured' : 'healthy'));

  // A new character starts healthy and untransformed, as it would out of the box.
  const [shownId, setShownId] = useState(character.id);
  if (shownId !== character.id) {
    setShownId(character.id);
    setSide('healthy');
    setMode(0);
  }

  /*
   * Mode 0 is the character itself. The default mode is not stored as a form
   * because everything outside this card wants the mode a character starts in
   * without having to ask which that is; the cards label it Normal.
   */
  const modes = character.forms.length > 0 ? ['Normal', ...character.forms.map(f => f.name)] : [];
  const active = mode === 0 ? character : (character.forms[mode - 1] ?? character);
  const block = active[side];

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
          {modes.length > 0 && (
            <div
              role="group"
              aria-label="Character mode"
              className="flex overflow-hidden rounded border border-surface-border text-xs"
            >
              {modes.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setMode(i)}
                  aria-pressed={mode === i}
                  className={`px-2 py-1 transition ${
                    mode === i
                      ? 'bg-sky-500/25 font-semibold text-slate-100'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/*
            Both faces are always offered rather than a single "flip" toggle:
            which side you are on is the thing worth showing, and a two-state
            control that names both states says it without being read.
          */}
          <div
            role="group"
            aria-label="Card side"
            className="flex overflow-hidden rounded border border-surface-border text-xs"
          >
            {(['healthy', 'injured'] as const).map(face => (
              <button
                key={face}
                type="button"
                onClick={() => setSide(face)}
                aria-pressed={side === face}
                className={`px-2 py-1 capitalize transition ${
                  side === face
                    ? 'bg-accent/20 font-semibold text-slate-100'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {face}
              </button>
            ))}
          </div>

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

      {scansMissing && (
        <p className="rounded border border-surface-border bg-surface px-2 py-1.5 text-xs text-slate-500">
          Card scans not downloaded.{' '}
          <code className="text-slate-400">npm run fetch:images --workspace @danger-room/data</code>
        </p>
      )}

      <Side
        block={block}
        threat={character.threat}
        scan={block.cardImage}
        alt={`${character.name}${mode > 0 ? ` (${modes[mode]})` : ''}, ${side} side`}
        onFlip={flip}
        onScanMissing={() => setScansMissing(true)}
      />

      {/*
        Errata sits under the card, where a footnote belongs. It explains a
        discrepancy the player hits at the table — the printed card in their
        hand says one thing and these stats say another — so it has to be
        present, but it is an annotation on the card rather than a warning
        about it.
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
    </article>
  );
}
