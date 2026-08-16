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
import { Grid, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useMemo } from 'react';
import { Vector3 } from 'three';
import {
  edgeDistance,
  hasLineOfSight,
  RANGE_INCHES,
  TABLE_SIZE,
  type Model,
  type TerrainVolume,
} from '@danger-room/rules';

import { selectGame, useStore } from '../store.js';

const TABLE_COLOR = '#1d2432';
const PLAYER_COLORS: Record<string, string> = {
  p1: '#4f8ff7',
  p2: '#e23636',
};

/** Table (x, y, elevation) → three.js (x, up, z). Confined to this file. */
const toScene = (x: number, y: number, z = 0): [number, number, number] => [x, z, y];

const titleCase = (id: string) =>
  id
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

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
  const fallback = useMemo(() => new Vector3(TABLE_SIZE.width / 2, 0, TABLE_SIZE.depth / 2), []);

  useFrame(() => {
    if (!active) return;
    // World +Z is screen-up, so table +y runs up the screen.
    camera.up.set(0, 0, 1);
    camera.lookAt(controls?.target ?? fallback);
    camera.updateMatrixWorld();
  });

  return null;
}

function Table() {
  // planeGeometry is centred on its own origin, so it must be offset by half
  // the table to line up with the engine's 0..36 coordinate space. At [0,0,0]
  // it would span -18..18 and sit almost entirely off the playable area.
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={toScene(TABLE_SIZE.width / 2, TABLE_SIZE.depth / 2)}
      receiveShadow
    >
      <planeGeometry args={[TABLE_SIZE.width, TABLE_SIZE.depth]} />
      <meshStandardMaterial color={TABLE_COLOR} />
    </mesh>
  );
}

/** The 36" edge, so it is obvious where the legal area stops. */
function TableEdge() {
  const { width: w, depth: d } = TABLE_SIZE;
  return (
    <Line
      points={[toScene(0, 0, 0.02), toScene(w, 0, 0.02), toScene(w, d, 0.02), toScene(0, d, 0.02), toScene(0, 0, 0.02)]}
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
function SightLines({ from, models, terrain }: { from: Model; models: Model[]; terrain: readonly TerrainVolume[] }) {
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
  distanceFromSelected,
}: {
  model: Model;
  selected: boolean;
  distanceFromSelected: number | null;
}) {
  const select = useStore(s => s.select);
  const color = PLAYER_COLORS[model.owner] ?? '#888888';
  const dimmed = model.health === 'ko';

  return (
    <group position={toScene(model.pos.x, model.pos.y, model.pos.z)}>
      {/* Base: the thing range is actually measured from. */}
      <mesh
        position={[0, 0.05, 0]}
        onClick={event => {
          event.stopPropagation();
          select(model.id);
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

      {/* Label. DOM rather than 3D text, so no webfont has to load. */}
      <Html center position={[0, model.height + 0.6, 0]} zIndexRange={[10, 0]}>
        <div className="pointer-events-none select-none whitespace-nowrap text-center">
          <div
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight"
            style={{
              background: 'rgba(15,17,23,0.85)',
              color,
              border: `1px solid ${color}55`,
            }}
          >
            {titleCase(model.characterId)}
          </div>
          <div className="mt-0.5 text-[9px] leading-tight text-slate-400">
            {model.health === 'ko' ? 'KO' : `${model.health} · ${model.damage} dmg · ${model.power}p`}
            {distanceFromSelected !== null && (
              <span className="ml-1 text-[#4ab3c7]">{distanceFromSelected.toFixed(1)}"</span>
            )}
          </div>
        </div>
      </Html>
    </group>
  );
}

function Scene() {
  const game = useStore(selectGame);
  const selectedId = useStore(s => s.selectedModel);
  const cameraMode = useStore(s => s.cameraMode);

  const models = useMemo(() => Object.values(game.models), [game.models]);
  const selected = selectedId ? game.models[selectedId] : undefined;
  const target = toScene(TABLE_SIZE.width / 2, TABLE_SIZE.depth / 2);

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
           * World +Z up the screen, so table +y does too. Deliberately no
           * `rotation` prop: OrbitControls calls lookAt every frame and would
           * silently overwrite it. TopDownLock below is what actually
           * guarantees the orientation.
           */
          up={[0, 0, 1]}
        />
      ) : (
        <PerspectiveCamera
          makeDefault
          position={toScene(TABLE_SIZE.width / 2, -14, 26)}
          fov={40}
          up={[0, 1, 0]}
        />
      )}

      <OrbitControls
        target={target}
        enableRotate={cameraMode === 'perspective'}
        makeDefault
      />
      <TopDownLock active={cameraMode === 'top-down'} />

      <ambientLight intensity={0.65} />
      <directionalLight position={[20, 40, 20]} intensity={1.1} castShadow />

      <Table />
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

      {models.map(model => (
        <ModelToken
          key={model.id}
          model={model}
          selected={model.id === selectedId}
          distanceFromSelected={
            selected && selected.id !== model.id ? edgeDistance(selected, model) : null
          }
        />
      ))}
    </>
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

      <Legend hasSelection={selectedId !== null} />
    </div>
  );
}
