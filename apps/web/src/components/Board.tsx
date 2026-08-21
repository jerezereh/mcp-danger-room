/**
 * The game board.
 *
 * This component is the whole "2D now, 3D later" argument made concrete. The
 * scene below is genuinely three-dimensional — models are cylinders at a real
 * elevation, terrain has height, the table is a plane in world space. The only
 * thing that makes it read as a flat top-down board is the camera.
 *
 * Toggling `cameraMode` swaps an orthographic camera looking straight down for
 * a perspective one at an angle. Nothing else changes. Going "3D" later is a
 * question of better meshes and better lighting, not a rewrite — which is
 * exactly what building a genuinely 2D board would have cost.
 *
 * What it draws is chosen so the board can be *checked*: range rings and sight
 * lines are read straight out of the engine's geometry, so a wrong measurement
 * or a bad line of sight is visible rather than buried in a test.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Grid,
  Html,
  Line,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import { useMemo } from 'react';
import { Vector3 } from 'three';
import {
  edgeDistance,
  hasLineOfSight,
  MOVEMENT_INCHES,
  RANGE_INCHES,
  TABLE_SIZE,
  type GameState,
  type Model,
  type ModelId,
  type TerrainVolume,
} from '@danger-room/rules';

import { toScene, fromScene } from '../lib/coords.js';
import { characterName, inches } from '../lib/format.js';
import { targetableBy } from '../lib/targeting.js';
import { selectGame, useStore } from '../store.js';

const TABLE_COLOR = '#1d2432';
const PLAYER_COLORS: Record<string, string> = {
  p1: '#4f8ff7',
  p2: '#e23636',
};

/**
 * The model whose activation is in progress, if the engine is asking it to act.
 *
 * Read from the prompt rather than from the selection: what you have clicked on
 * to inspect and what is legally acting are different questions, and conflating
 * them is how you end up moving the wrong model.
 */
function activatingModel(state: GameState): Model | null {
  const prompt = state.prompt;
  if (prompt?.kind !== 'chooseAction') return null;
  return state.models[prompt.modelId] ?? null;
}

/**
 * Pin the top-down camera's orientation.
 *
 * The board was rendering at an arbitrary ~115° roll. Projecting the table
 * corners through a bare three.js camera headlessly reproduces *none* of it —
 * `lookAt` comes out perfectly axis-aligned with either `up` vector — so the
 * roll comes from something in the live OrbitControls interaction that static
 * analysis did not surface.
 *
 * Rather than guess further, this asserts the orientation directly. It runs at
 * the default frame priority, which is after drei's OrbitControls (priority
 * -1), so whatever the controls leave behind is corrected before the frame is
 * drawn. Rotation is disabled in top-down anyway, so forcing the orientation
 * costs nothing and makes the roll structurally impossible regardless of cause.
 *
 * `lookAt` targets the controls' *current* target rather than a fixed point, so
 * panning still works.
 */
function TopDownLock({ active }: { active: boolean }) {
  const camera = useThree(state => state.camera);
  const controls = useThree(state => state.controls) as { target?: Vector3 } | null;
  const fallback = useMemo(
    () => new Vector3(...toScene(TABLE_SIZE.width / 2, TABLE_SIZE.depth / 2)),
    [],
  );

  useFrame(() => {
    if (!active) return;
    // Pairs with toScene's negated y: -Z screen-up puts table +y up.
    camera.up.set(0, 0, -1);
    camera.lookAt(controls?.target ?? fallback);
    camera.updateMatrixWorld();
  });

  return null;
}

function Table({ onPick }: { onPick: (point: { x: number; z: number }) => void }) {
  // planeGeometry is centred on its own origin, so it must be offset by half
  // the table to line up with the engine's 0..36 coordinate space. At [0,0,0]
  // it would span -18..18 and sit almost entirely off the playable area.
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={toScene(TABLE_SIZE.width / 2, TABLE_SIZE.depth / 2)}
      receiveShadow
      onClick={event => {
        event.stopPropagation();
        onPick(event.point);
      }}
    >
      <planeGeometry args={[TABLE_SIZE.width, TABLE_SIZE.depth]} />
      <meshStandardMaterial color={TABLE_COLOR} />
    </mesh>
  );
}

/**
 * How far the activating model may move, drawn where it will be measured from.
 *
 * Drawn around the centre rather than around the base edge, unlike the range
 * rings. That is not an inconsistency: a move is measured edge-to-edge too,
 * but both ends of that measurement are the same base, so the centre travels
 * the tool's full length. Range measures between two different bases, and both
 * of them come off the distance.
 */
function MoveRing({ model, template }: { model: Model; template: 'S' | 'M' | 'L' }) {
  const radius = MOVEMENT_INCHES[template];
  return (
    <group position={toScene(model.pos.x, model.pos.y, model.pos.z + 0.04)}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.05, radius + 0.05, 96]} />
        <meshBasicMaterial color="#5fbd84" transparent opacity={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius, 96]} />
        <meshBasicMaterial color="#5fbd84" transparent opacity={0.07} />
      </mesh>
    </group>
  );
}

/** The 36" edge, so it is obvious where the legal area stops. */
function TableEdge() {
  const { width: w, depth: d } = TABLE_SIZE;
  return (
    <Line
      points={[
        toScene(0, 0, 0.02),
        toScene(w, 0, 0.02),
        toScene(w, d, 0.02),
        toScene(0, d, 0.02),
        toScene(0, 0, 0.02),
      ]}
      color="#4a5570"
      lineWidth={1.5}
    />
  );
}

function TerrainPiece({ volume }: { volume: TerrainVolume }) {
  return (
    <mesh
      position={toScene(volume.pos.x, volume.pos.y, volume.pos.z + volume.height / 2)}
      castShadow
      receiveShadow
    >
      <cylinderGeometry args={[volume.radius, volume.radius, volume.height, 20]} />
      <meshStandardMaterial color="#39425c" roughness={0.9} />
    </mesh>
  );
}

/**
 * Range bands R1–R5 around the selected model.
 *
 * Drawn from the *base edge*, which is how MCP measures — so these rings are a
 * direct visual assertion about `edgeDistance`. If a ring disagrees with the
 * distance readout in the panel, the geometry is wrong.
 */
function RangeRings({ model }: { model: Model }) {
  const bands = [1, 2, 3, 4, 5] as const;

  return (
    <group position={toScene(model.pos.x, model.pos.y, model.pos.z + 0.03)}>
      {bands.map(band => {
        const radius = model.radius + RANGE_INCHES[band];
        return (
          <mesh key={band} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[radius - 0.03, radius + 0.03, 96]} />
            <meshBasicMaterial color="#4ab3c7" transparent opacity={0.55 - band * 0.06} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * Sight lines from the selected model to every other model.
 *
 * Green means the engine says line of sight is clear, red means terrain blocks
 * it. Because this calls the same `hasLineOfSight` the rules use, a wrong
 * answer shows up as a line that visibly passes through a wall while claiming
 * to be clear.
 */
function SightLines({
  from,
  models,
  terrain,
}: {
  from: Model;
  models: Model[];
  terrain: readonly TerrainVolume[];
}) {
  return (
    <>
      {models
        .filter(m => m.id !== from.id && m.health !== 'ko')
        .map(target => {
          const los = hasLineOfSight(from, target, terrain);
          return (
            <Line
              key={target.id}
              points={[
                toScene(from.pos.x, from.pos.y, from.pos.z + from.height * 0.5),
                toScene(target.pos.x, target.pos.y, target.pos.z + target.height * 0.5),
              ]}
              color={los.clear ? '#5fbd84' : '#e0655a'}
              lineWidth={1.5}
              dashed={!los.clear}
              dashSize={0.3}
              gapSize={0.2}
            />
          );
        })}
    </>
  );
}

function ModelToken({
  model,
  selected,
  targetable,
  distanceFromSelected,
  onPick,
}: {
  model: Model;
  selected: boolean;
  /** A legal-looking target for the attack currently being aimed. */
  targetable: boolean;
  distanceFromSelected: number | null;
  onPick: (id: ModelId) => void;
}) {
  const color = PLAYER_COLORS[model.owner] ?? '#888888';
  const dimmed = model.health === 'ko';

  return (
    <group position={toScene(model.pos.x, model.pos.y, model.pos.z)}>
      {/* A ring under anything the aimed attack can currently reach. */}
      {targetable && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[model.radius + 0.12, model.radius + 0.3, 48]} />
          <meshBasicMaterial color="#f2b134" transparent opacity={0.95} />
        </mesh>
      )}

      {/* Base: the thing range is actually measured from. */}
      <mesh
        position={[0, 0.05, 0]}
        onClick={event => {
          event.stopPropagation();
          onPick(model.id);
        }}
        castShadow
      >
        <cylinderGeometry args={[model.radius, model.radius, 0.1, 32]} />
        <meshStandardMaterial
          color={color}
          opacity={dimmed ? 0.3 : 1}
          transparent={dimmed}
          emissive={selected ? color : '#000000'}
          emissiveIntensity={selected ? 0.7 : 0}
        />
      </mesh>

      {/* Silhouette: carries the height that line of sight depends on. */}
      <mesh position={[0, model.height / 2, 0]} castShadow>
        <cylinderGeometry args={[model.radius * 0.55, model.radius * 0.7, model.height, 20]} />
        <meshStandardMaterial color={color} opacity={dimmed ? 0.15 : 0.8} transparent />
      </mesh>

      {/*
        Label. DOM rather than 3D text, so no webfont has to load.

        Labels are constant screen size, so at 4" apart two full stat lines
        collide. Only the selected model shows its detail; everything else shows
        a name and, when relevant, its distance from the selection.
      */}
      <Html center position={[0, model.height + 0.6, 0]} zIndexRange={[10, 0]}>
        <div className="pointer-events-none select-none whitespace-nowrap text-center">
          <div
            className="rounded px-1 py-px text-[9px] font-semibold leading-tight"
            style={{
              background: 'rgba(15,17,23,0.88)',
              color,
              border: `1px solid ${color}55`,
            }}
          >
            {characterName(model.characterId)}
            {distanceFromSelected !== null && (
              <span className="ml-1 font-normal text-[#4ab3c7]">
                {inches(distanceFromSelected)}
              </span>
            )}
          </div>
          {(selected || model.dazed || model.health !== 'healthy' || model.damage > 0) && (
            <div className="mt-px text-[9px] leading-tight text-slate-400">
              {model.health === 'ko'
                ? 'KO'
                : `${model.dazed ? 'Dazed' : model.health} · ${model.damage} dmg · ${model.power}p`}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

function Scene() {
  const game = useStore(selectGame);
  const selectedId = useStore(s => s.selectedModel);
  const cameraMode = useStore(s => s.cameraMode);
  const boardMode = useStore(s => s.boardMode);
  const dispatch = useStore(s => s.dispatch);
  const select = useStore(s => s.select);

  const models = useMemo(() => Object.values(game.models), [game.models]);
  const selected = selectedId ? game.models[selectedId] : undefined;
  const target = toScene(TABLE_SIZE.width / 2, TABLE_SIZE.depth / 2);

  const acting = activatingModel(game);

  /**
   * A click on the table is a move, or nothing.
   *
   * The path is a single destination: the engine measures from where the model
   * actually is, so one point is a straight move. Curved paths are expressible
   * in the action — `path` is a polyline — and there is no UI for drawing one
   * yet.
   */
  const pickDestination = (point: { x: number; z: number }) => {
    if (boardMode.kind !== 'move' || !acting) return;
    dispatch({
      type: 'MOVE',
      player: acting.owner,
      modelId: acting.id,
      template: boardMode.template,
      path: [fromScene(point)],
    });
  };

  /** A click on a model is an attack while one is aimed, and a selection otherwise. */
  const pickModel = (id: ModelId) => {
    if (boardMode.kind === 'attack' && acting && id !== acting.id) {
      dispatch({
        type: 'ATTACK',
        player: acting.owner,
        attackerId: acting.id,
        targetId: id,
        attackName: boardMode.attackName,
      });
      return;
    }
    select(id);
  };

  const targetable = useMemo(
    () => targetableBy(game, acting, boardMode.kind === 'attack' ? boardMode.attackName : null),
    [game, acting, boardMode],
  );

  return (
    <>
      {cameraMode === 'top-down' ? (
        <OrthographicCamera
          makeDefault
          position={toScene(TABLE_SIZE.width / 2, TABLE_SIZE.depth / 2, 40)}
          zoom={17}
          near={0.1}
          far={200}
          /*
           * -Z up the screen which, with toScene's negated y, puts table +y
           * up. Deliberately no `rotation` prop: OrbitControls calls lookAt
           * every frame and would silently overwrite it. TopDownLock below is
           * what actually guarantees the orientation.
           */
          up={[0, 0, -1]}
        />
      ) : (
        <PerspectiveCamera
          makeDefault
          position={toScene(TABLE_SIZE.width / 2, -14, 26)}
          fov={40}
          up={[0, 1, 0]}
        />
      )}

      <OrbitControls target={target} enableRotate={cameraMode === 'perspective'} makeDefault />
      <TopDownLock active={cameraMode === 'top-down'} />

      <ambientLight intensity={0.65} />
      <directionalLight position={[20, 40, 20]} intensity={1.1} castShadow />

      <Table onPick={pickDestination} />
      <Grid
        args={[TABLE_SIZE.width, TABLE_SIZE.depth]}
        position={toScene(TABLE_SIZE.width / 2, TABLE_SIZE.depth / 2, 0.01)}
        cellSize={1}
        sectionSize={6}
        cellColor="#2a3142"
        sectionColor="#39405a"
        fadeDistance={140}
        infiniteGrid={false}
      />
      <TableEdge />

      {game.terrain.map(volume => (
        <TerrainPiece key={volume.id} volume={volume} />
      ))}

      {selected && <RangeRings model={selected} />}
      {selected && <SightLines from={selected} models={models} terrain={game.terrain} />}
      {acting && boardMode.kind === 'move' && (
        <MoveRing model={acting} template={boardMode.template} />
      )}

      {models.map(model => (
        <ModelToken
          key={model.id}
          model={model}
          selected={model.id === selectedId}
          targetable={targetable.has(model.id)}
          onPick={pickModel}
          distanceFromSelected={
            selected && selected.id !== model.id ? edgeDistance(selected, model) : null
          }
        />
      ))}
    </>
  );
}

/**
 * What a click will do, said out loud.
 *
 * The board is one surface with three jobs — inspect, move, shoot — and no way
 * to tell them apart by looking, so it says which one is armed.
 */
function ModeHint() {
  const boardMode = useStore(s => s.boardMode);
  if (boardMode.kind === 'idle') return null;

  const text =
    boardMode.kind === 'move'
      ? `Click the board to move — ${boardMode.template} template`
      : `Click a target for ${boardMode.attackName}`;

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-md border border-accent/40 bg-surface-raised/95 px-3 py-1.5 text-xs text-slate-200 backdrop-blur">
      {text}
    </div>
  );
}

/** Legend, so the colours on the board mean something without guessing. */
function Legend({ hasSelection }: { hasSelection: boolean }) {
  if (!hasSelection) {
    return (
      <p className="absolute bottom-4 left-4 text-xs text-slate-600">
        Select a model to show range bands and sight lines.
      </p>
    );
  }
  return (
    <div className="absolute bottom-4 left-4 flex flex-col gap-1 text-[11px] text-slate-500">
      <span className="flex items-center gap-2">
        <span className="inline-block h-0.5 w-4" style={{ background: '#4ab3c7' }} />
        Range bands R1–R5, measured from the base edge
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-block h-0.5 w-4" style={{ background: '#5fbd84' }} />
        Line of sight clear
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-block h-0.5 w-4" style={{ background: '#e0655a' }} />
        Line of sight blocked by terrain
      </span>
    </div>
  );
}

export function Board() {
  const cameraMode = useStore(s => s.cameraMode);
  const setCameraMode = useStore(s => s.setCameraMode);
  const selectedId = useStore(s => s.selectedModel);

  return (
    <div className="relative h-full w-full">
      <Canvas shadows className="h-full w-full">
        <Scene />
      </Canvas>

      <button
        type="button"
        onClick={() => setCameraMode(cameraMode === 'top-down' ? 'perspective' : 'top-down')}
        className="absolute left-4 top-4 rounded-md border border-surface-border bg-surface-raised/90 px-3 py-1.5 text-sm text-slate-300 backdrop-blur transition hover:text-white"
      >
        {cameraMode === 'top-down' ? 'Perspective view' : 'Top-down view'}
      </button>

      <ModeHint />
      <Legend hasSelection={selectedId !== null} />
    </div>
  );
}
