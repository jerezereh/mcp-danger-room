/**
 * What you can do right now.
 *
 * Every control here is rendered from `state.prompt`. The engine parks a
 * prompt saying exactly what it is waiting for and from whom, so the buttons
 * on screen are the engine's opinion rather than a second implementation of
 * the rules in the UI — which is the thing `docs/ARCHITECTURE.md` §8 warns
 * against.
 *
 * That has a consequence worth stating: nothing here decides whether an action
 * is *legal*. Range and line of sight are used to grey a button and to colour
 * a target on the board, and they call the engine's own exported geometry to
 * do it — but the engine is still asked, and its rejection is what the player
 * is shown. A disabled button is a hint; a refusal is the answer.
 */

import {
  ACTIONS_PER_ACTIVATION,
  edgeDistance,
  hasLineOfSight,
  MOVEMENT_INCHES,
  RANGE_INCHES,
  statsAt,
  type AttackProfile,
  type GameState,
  type Model,
  type ModelId,
  type MovementTemplate,
} from '@danger-room/rules';

import { describeOutcome } from '../lib/eventText.js';
import { characterName, toolInches } from '../lib/format.js';
import { selectGame, useStore, type BoardMode } from '../store.js';

const TEMPLATES: readonly MovementTemplate[] = ['S', 'M', 'L'];

function Button({
  onClick,
  disabled,
  title,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded px-2 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:bg-surface disabled:text-slate-600 ${
        active ? 'bg-accent text-white' : 'bg-accent/70 text-white hover:bg-accent'
      }`}
    >
      {children}
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</h4>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Can this attack reach that model at all? A hint for the button, not a rule. */
function reachable(
  state: GameState,
  attacker: Model,
  attack: AttackProfile,
  target: Model,
): boolean {
  if (attack.shape !== 'range' || attack.range === '*') return false;
  if (edgeDistance(attacker, target) > RANGE_INCHES[attack.range]) return false;
  return hasLineOfSight(attacker, target, state.terrain).clear;
}

const enemiesOf = (state: GameState, model: Model): Model[] =>
  Object.values(state.models).filter(
    other => other.owner !== model.owner && other.health !== 'ko' && !other.dazed,
  );

// ---------------------------------------------------------------------------
// One panel per kind of prompt
// ---------------------------------------------------------------------------

function ChooseActivation({
  player,
  options,
  mayPass,
}: {
  player: string;
  options: readonly ModelId[];
  mayPass: boolean;
}) {
  const dispatch = useStore(s => s.dispatch);
  const select = useStore(s => s.select);
  const game = useStore(selectGame);

  return (
    <>
      <Section label="Activate">
        {options.map(id => (
          <Button
            key={id}
            onClick={() => {
              select(id);
              dispatch({ type: 'ACTIVATE', player: player as never, modelId: id });
            }}
          >
            {characterName(game.models[id]?.characterId ?? id)}
          </Button>
        ))}
      </Section>

      {mayPass && (
        <Section label="Or">
          <Button onClick={() => dispatch({ type: 'PASS_TURN', player: player as never })}>
            Pass the turn
          </Button>
        </Section>
      )}
    </>
  );
}

function ChooseAction({ player, modelId }: { player: string; modelId: ModelId }) {
  const dispatch = useStore(s => s.dispatch);
  const game = useStore(selectGame);
  const boardMode = useStore(s => s.boardMode);
  const setBoardMode = useStore(s => s.setBoardMode);

  const model = game.models[modelId];
  const profile = model ? game.profiles[model.characterId] : undefined;
  if (!model || !profile) return null;

  const stats = statsAt(profile, model.health);
  const frame = game.stack[game.stack.length - 1];
  const remaining = frame?.kind === 'activation' ? frame.actionsRemaining : 0;

  // "A character may use a shorter Movement Tool than what is listed on its
  // card." Longer is what the engine refuses.
  const printed = TEMPLATES.indexOf(stats.movement);
  const allowed = TEMPLATES.filter((_, index) => index <= printed);

  const enemies = enemiesOf(game, model);
  const armed = (attack: AttackProfile) => enemies.some(e => reachable(game, model, attack, e));

  const setMode = (mode: BoardMode) => setBoardMode(mode);

  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-slate-200">{characterName(model.characterId)}</span>
        <span className="text-[10px] tabular-nums text-slate-500">
          {remaining} of {ACTIONS_PER_ACTIVATION} actions
        </span>
      </div>

      <Section label="Move">
        {allowed.map(template => (
          <Button
            key={template}
            active={boardMode.kind === 'move' && boardMode.template === template}
            onClick={() =>
              setMode(
                boardMode.kind === 'move' && boardMode.template === template
                  ? { kind: 'idle' }
                  : { kind: 'move', template },
              )
            }
            title={`${toolInches(MOVEMENT_INCHES[template])} — then click the board`}
          >
            {template} · {toolInches(MOVEMENT_INCHES[template])}
          </Button>
        ))}
      </Section>

      <Section label="Attack">
        {stats.attacks.map(attack => {
          const usable = armed(attack);
          const cost = typeof attack.cost === 'number' ? attack.cost : 0;
          const affordable = model.power >= cost;

          return (
            <Button
              key={attack.name}
              active={boardMode.kind === 'attack' && boardMode.attackName === attack.name}
              disabled={!usable || !affordable}
              title={
                !affordable
                  ? `Costs ${cost} Power; this character has ${model.power}`
                  : usable
                    ? 'Then click a target'
                    : 'Nothing in range and line of sight'
              }
              onClick={() =>
                setMode(
                  boardMode.kind === 'attack' && boardMode.attackName === attack.name
                    ? { kind: 'idle' }
                    : { kind: 'attack', attackName: attack.name },
                )
              }
            >
              {attack.name}
              <span className="ml-1 font-normal opacity-70">
                {attack.dice}d R{attack.range}
                {cost > 0 && ` · ${cost}p`}
              </span>
            </Button>
          );
        })}
      </Section>

      <Section label="Finish">
        <Button onClick={() => dispatch({ type: 'END_ACTIVATION', player: player as never })}>
          End activation
        </Button>
      </Section>
    </>
  );
}

function DeclareReaction({
  player,
  timing,
  options,
}: {
  player: string;
  timing: string;
  options: readonly { modelId: ModelId; superpower: string; cost: number }[];
}) {
  const dispatch = useStore(s => s.dispatch);
  const game = useStore(selectGame);

  return (
    <>
      <p className="text-xs text-slate-400">
        Resolution is paused at the <span className="text-slate-200">{timing}</span> window.
      </p>

      <Section label="Use a superpower">
        {options.map(option => (
          <Button
            key={`${option.modelId}:${option.superpower}`}
            onClick={() =>
              dispatch({
                type: 'DECLARE_REACTION',
                player: player as never,
                modelId: option.modelId,
                superpower: option.superpower,
              })
            }
            title={`${characterName(game.models[option.modelId]?.characterId ?? '')} · ${option.cost} Power`}
          >
            {option.superpower}
            <span className="ml-1 font-normal opacity-70">{option.cost}p</span>
          </Button>
        ))}
      </Section>

      <Section label="Or">
        <Button onClick={() => dispatch({ type: 'PASS_REACTION', player: player as never })}>
          Decline
        </Button>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

export function ActionBar() {
  const game = useStore(selectGame);
  const prompt = game.prompt;

  if (game.phase === 'finished') {
    return (
      <div className="border-b border-surface-border p-3">
        <p className="text-xs text-slate-500">{describeOutcome(game)}. Start a new one below.</p>
      </div>
    );
  }

  if (!prompt) {
    return (
      <div className="border-b border-surface-border p-3">
        <p className="text-xs text-slate-600">Resolving…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-b border-surface-border p-3">
      {prompt.kind === 'chooseActivation' && (
        <ChooseActivation
          player={prompt.player}
          options={prompt.options}
          mayPass={prompt.mayPass}
        />
      )}
      {prompt.kind === 'chooseAction' && (
        <ChooseAction player={prompt.player} modelId={prompt.modelId} />
      )}
      {prompt.kind === 'declareReaction' && (
        <DeclareReaction player={prompt.player} timing={prompt.timing} options={prompt.options} />
      )}
    </div>
  );
}
