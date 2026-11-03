'use client';

import { evaluatedScene } from '@ass/editor-ui';
import { verticalFovDegrees, worldMatrix } from '@ass/scene-engine';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { useEditor } from './context';
import { EntityChildren, ViewOptions } from './Viewport';

/** Caméra de rendu pilotée par la caméra active évaluée à la frame courante. */
function ActiveCameraRig({ aspect }: { aspect: number }) {
  const scene = useEditor(evaluatedScene);
  const set = useThree((state) => state.set);
  const camera = scene.cameras.find((c) => c.id === scene.activeCameraId) ?? null;
  const perspective = useMemo(() => new PerspectiveCamera(), []);
  const orthographic = useMemo(() => new OrthographicCamera(), []);

  useFrame(() => {
    if (!camera) return;
    const target = camera.projection === 'orthographic' ? orthographic : perspective;
    const matrix = worldMatrix(scene, camera.id);
    const position = new Vector3();
    const rotation = new Quaternion();
    matrix.decompose(position, rotation, new Vector3());
    target.position.copy(position);
    target.quaternion.copy(rotation);
    target.near = camera.nearClip;
    target.far = camera.farClip;
    if (target instanceof PerspectiveCamera) {
      target.fov = verticalFovDegrees(camera.focalLengthMm, camera.sensorWidthMm, aspect);
      target.aspect = aspect;
    } else {
      const half = (camera.orthographicHeight ?? 2) / 2;
      Object.assign(target, {
        top: half,
        bottom: -half,
        left: -half * aspect,
        right: half * aspect,
      });
    }
    target.updateProjectionMatrix();
    target.updateMatrixWorld();
    set({ camera: target });
  });
  return null;
}

export function CameraViewport() {
  const width = useEditor((state) => state.scene.renderSettings.width);
  const height = useEditor((state) => state.scene.renderSettings.height);
  const active = useEditor(
    (state) => state.scene.cameras.find((c) => c.id === state.scene.activeCameraId) ?? null,
  );
  const hasLights = useEditor((state) => state.scene.lights.some((light) => light.visible));
  const aspect = width / height;

  return (
    <div
      className="flex h-full w-full items-center justify-center bg-black p-2"
      data-testid="camera-view"
    >
      {active ? (
        <div className="relative max-h-full w-full" style={{ aspectRatio: `${width} / ${height}` }}>
          <Canvas shadows gl={{ preserveDrawingBuffer: true }} className="!absolute inset-0">
            <ViewOptions.Provider value={{ interactive: false, helpers: false }}>
              <ActiveCameraRig aspect={aspect} />
              <hemisphereLight args={['#ffffff', '#444444', hasLights ? 0.4 : 1.2]} />
              {!hasLights && <directionalLight position={[5, 8, 4]} intensity={1.5} castShadow />}
              <EntityChildren parentId={null} onRegistered={() => undefined} />
            </ViewOptions.Provider>
          </Canvas>
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-text">
            {active.name} · {active.focalLengthMm.toFixed(1).replace('.', ',')} mm · {width}×
            {height}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Aucune caméra active : choisissez-en une dans la barre d’outils.
        </p>
      )}
    </div>
  );
}
