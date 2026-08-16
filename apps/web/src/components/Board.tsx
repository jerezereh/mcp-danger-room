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
 */

import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useMemo } from 'react';
import { TABLE_SIZE, type Model, type TerrainVolume } from '@danger-room/rules';

import { useStore } from '../store.js';

const TABLE_COLOR = '#1d2432';
const PLAYER_COLORS: Record<string, string> = {
  p1: '#4f8ff7',
  p2: '#e23636',
};

function Table() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[TABLE_SIZE.width, TABLE_SIZE.depth]} />
      <meshStandardMaterial color={TABLE_COLOR} />
    </mesh>
  );
}

function TerrainPiece({ volume }: { volume: TerrainVolume }) {
  // Table coordinates are x/y with z as elevation; three.js is x/z with y up.
  // The swap is confined to this one place so the engine never has to know.
  return (
    <mesh
      position={[volume.pos.x, volume.pos.z + volume.height / 2, volume.pos.y]}
      castShadow
      receiveShadow
    >
      <cylinderGeometry args={[volume.radius, volume.radius, volume.height, 16]} />
      <meshStandardMaterial color="#3a4256" />
    </mesh>
  );
}

function ModelToken({ model, selected }: { model: Model; selected: boolean }) {
  const select = useStore(s => s.select);
  const color = PLAYER_COLORS[model.owner] ?? '#888888';
  const dimmed = model.health === 'ko';

  return (
    <group position={[model.pos.x, model.pos.z, model.pos.y]}>
      {/* Base: the thing range is actually measured from. */}
      <mesh
        position={[0, 0.05, 0]}
        onClick={event => {
          event.stopPropagation();
          select(model.id);
        }}
        castShadow
      >
        <cylinderGeometry args={[model.radius, model.radius, 0.1, 24]} />
        <meshStandardMaterial
          color={color}
          opacity={dimmed ? 0.3 : 1}
          transparent={dimmed}
          emissive={selected ? color : '#000000'}
          emissiveIntensity={selected ? 0.6 : 0}
        />
      </mesh>

      {/* Silhouette: carries the height that line of sight depends on. */}
      <mesh position={[0, model.height / 2, 0]} castShadow>
        <cylinderGeometry args={[model.radius * 0.55, model.radius * 0.7, model.height, 16]} />
        <meshStandardMaterial
          color={color}
          opacity={dimmed ? 0.15 : 0.85}
          transparent
        />
      </mesh>
    </group>
  );
}

function Scene() {
  const game = useStore(s => s.game);
  const selected = useStore(s => s.selectedModel);
  const cameraMode = useStore(s => s.cameraMode);

  const models = useMemo(() => Object.values(game.models), [game.models]);
  const center: [number, number, number] = [TABLE_SIZE.width / 2, 0, TABLE_SIZE.depth / 2];

  return (
    <>
      {cameraMode === 'top-down' ? (
        <OrthographicCamera
          makeDefault
          position={[TABLE_SIZE.width / 2, 40, TABLE_SIZE.depth / 2]}
          zoom={18}
          near={0.1}
          far={200}
          // Looking straight down. This single line is the "2D mode".
          rotation={[-Math.PI / 2, 0, 0]}
        />
      ) : (
        <PerspectiveCamera
          makeDefault
          position={[TABLE_SIZE.width / 2, 26, TABLE_SIZE.depth + 18]}
          fov={40}
        />
      )}

      <OrbitControls
        target={center}
        enableRotate={cameraMode === 'perspective'}
        makeDefault
      />

      <ambientLight intensity={0.6} />
      <directionalLight position={[20, 40, 20]} intensity={1.1} castShadow />

      <group position={[0, 0, 0]}>
        <Table />
        <Grid
          args={[TABLE_SIZE.width, TABLE_SIZE.depth]}
          position={[TABLE_SIZE.width / 2, 0.01, TABLE_SIZE.depth / 2]}
          cellSize={1}
          sectionSize={6}
          cellColor="#2a3142"
          sectionColor="#39405a"
          fadeDistance={120}
          infiniteGrid={false}
        />
        {game.terrain.map(volume => (
          <TerrainPiece key={volume.id} volume={volume} />
        ))}
        {models.map(model => (
          <ModelToken key={model.id} model={model} selected={model.id === selected} />
        ))}
      </group>
    </>
  );
}

export function Board() {
  const cameraMode = useStore(s => s.cameraMode);
  const setCameraMode = useStore(s => s.setCameraMode);

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
    </div>
  );
}
