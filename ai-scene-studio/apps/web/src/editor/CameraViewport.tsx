'use client';

import { evaluatedScene } from '@ass/editor-ui';
import { setActiveCamera, verticalFovDegrees, worldMatrix } from '@ass/scene-engine';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { GenerationJob, ShotVersion } from '@ass/api-client';
import { Image as ImageIcon, Video } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { api, call } from '@/lib/api';
import { useEditor, useEditorContext } from './context';
import { dimensions, enregistrerVueCamera } from './videoGrise';
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

/**
 * Version du plan posée sur la vue caméra : c'est ainsi qu'on juge si les volumes tombent au bon
 * endroit. Par défaut, celle dont le plateau a été tiré. Elle ne change rien à la scène ni au rendu.
 */
function PhotoDuPlan() {
  const { shotId, assetUrl } = useEditorContext();
  const frame = useEditor((state) => state.frame);
  const fps = useEditor((state) => state.scene.fps.numerator / state.scene.fps.denominator);
  const [versions, setVersions] = useState<ShotVersion[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [opacite, setOpacite] = useState(50);
  const video = useRef<HTMLVideoElement | null>(null);

  // Relue régulièrement : une image qui vient d'être générée se pose d'elle-même sur la 3D.
  const choixManuel = useRef(false);
  useEffect(() => {
    if (!shotId) return undefined;
    let vivant = true;
    const lire = () =>
      Promise.all([
        call(api.GET('/shots/{shot_id}/versions', { params: { path: { shot_id: shotId } } })),
        call(api.GET('/shots/{shot_id}/generations', { params: { path: { shot_id: shotId } } })),
      ])
        .then(([liste, jobs]: [ShotVersion[], GenerationJob[]]) => {
          if (!vivant) return;
          setVersions(liste);
          if (choixManuel.current) return;
          const plusRecent = jobs.find((job) => job.status === 'completed');
          const origine =
            plusRecent?.mode === 'scene_from_shot' ? plusRecent.request['parentVersionId'] : null;
          setVersionId(typeof origine === 'string' ? origine : (liste[0]?.id ?? null));
        })
        .catch(() => undefined);
    void lire();
    const minuterie = setInterval(() => void lire(), 8000);
    return () => {
      vivant = false;
      clearInterval(minuterie);
    };
  }, [shotId]);

  // La vidéo suit la tête de lecture : on compare la bonne image, pas seulement la première.
  useEffect(() => {
    if (video.current) video.current.currentTime = frame / fps;
  }, [frame, fps]);

  const version = versions.find((v) => v.id === versionId) ?? null;
  if (!version) return null;
  const style = { opacity: opacite / 100 };
  return (
    <>
      {visible &&
        (version.kind === 'video' ? (
          <video
            ref={video}
            src={assetUrl(version.assetId)}
            muted
            playsInline
            preload="auto"
            data-testid="photo-du-plan"
            style={style}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <img
            src={assetUrl(version.assetId)}
            alt=""
            data-testid="photo-du-plan"
            style={style}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
        ))}
      <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded bg-black/70 px-2 py-1 text-xs text-text">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
          />
          <ImageIcon size={13} /> Photo du plan
        </label>
        {versions.length > 1 && (
          <select
            aria-label="Version superposée"
            value={version.id}
            onChange={(event) => {
              choixManuel.current = true;
              setVersionId(event.target.value);
            }}
            className="rounded bg-surface px-1"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.number}
              </option>
            ))}
          </select>
        )}
        <input
          type="range"
          aria-label="Opacité de la photo"
          min={0}
          max={100}
          value={opacite}
          disabled={!visible}
          onChange={(event) => setOpacite(Number(event.target.value))}
          className="w-28"
        />
        <span className="w-8 text-right tabular-nums">{opacite} %</span>
      </div>
    </>
  );
}

/** Les caméras du plateau, d'un clic : on passe de l'une à l'autre comme sur un tournage. */
function BandeCameras() {
  const { store } = useEditorContext();
  const cameras = useEditor((state) => state.scene.cameras);
  const activeId = useEditor((state) => state.scene.activeCameraId);
  if (cameras.length < 2) return null;
  return (
    <div
      role="group"
      aria-label="Caméras du plateau"
      className="absolute right-2 top-2 flex max-w-[70%] flex-wrap justify-end gap-1"
    >
      {cameras.map((camera) => (
        <button
          key={camera.id}
          type="button"
          aria-pressed={camera.id === activeId}
          onClick={() => store.getState().apply((scene) => setActiveCamera(scene, camera.id))}
          className={`rounded px-2 py-0.5 text-xs ${camera.id === activeId ? 'bg-accent text-white' : 'bg-black/60 text-text hover:bg-black/80'}`}
        >
          {camera.name}
        </button>
      ))}
    </div>
  );
}

/**
 * Enregistre la vue caméra sur toute la durée du plan, dans le navigateur : la vidéo grise qui
 * guidera le générateur (même mouvement de caméra, mêmes places).
 */
function VideoGrise({ source }: { source: React.RefObject<HTMLCanvasElement | null> }) {
  const { store } = useEditorContext();
  const frames = useEditor((state) => state.scene.durationFrames);
  const fps = useEditor((state) => state.scene.fps.numerator / state.scene.fps.denominator);
  const width = useEditor((state) => state.scene.renderSettings.width);
  const height = useEditor((state) => state.scene.renderSettings.height);
  const [progres, setProgres] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const enregistrer = async () => {
    const canvas = source.current;
    if (!canvas) return;
    const depart = store.getState().frame;
    setErreur(null);
    setProgres(0);
    try {
      const video = await enregistrerVueCamera({
        source: canvas,
        frames,
        fps,
        ...dimensions(width, height),
        allerA: (frame) => store.getState().setFrame(frame),
        onProgres: (frame) => setProgres(frame + 1),
      });
      const lien = document.createElement('a');
      lien.href = URL.createObjectURL(video);
      lien.download = `video-grise.${video.type.includes('mp4') ? 'mp4' : 'webm'}`;
      lien.click();
      setTimeout(() => URL.revokeObjectURL(lien.href), 10_000);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      store.getState().setFrame(depart);
      setProgres(null);
    }
  };

  return (
    <div className="absolute bottom-2 right-2 flex items-center gap-2 rounded bg-black/70 px-2 py-1 text-xs text-text">
      {erreur && <span className="text-red-400">{erreur}</span>}
      <button
        type="button"
        disabled={progres !== null}
        onClick={() => void enregistrer()}
        title="Rejoue le plan dans la vue caméra et télécharge la vidéo grise (référence de mouvement)"
        className="flex items-center gap-1.5 hover:text-white disabled:opacity-60"
      >
        <Video size={13} />
        {progres === null ? 'Vidéo grise' : `Enregistrement ${progres}/${frames}`}
      </button>
    </div>
  );
}

export function CameraViewport() {
  const width = useEditor((state) => state.scene.renderSettings.width);
  const height = useEditor((state) => state.scene.renderSettings.height);
  const active = useEditor(
    (state) => state.scene.cameras.find((c) => c.id === state.scene.activeCameraId) ?? null,
  );
  const hasLights = useEditor((state) => state.scene.lights.some((light) => light.visible));
  const aspect = width / height;
  const toile = useRef<HTMLCanvasElement | null>(null);

  return (
    <div
      className="flex h-full w-full items-center justify-center bg-black p-2"
      data-testid="camera-view"
    >
      {active ? (
        <div className="relative max-h-full w-full" style={{ aspectRatio: `${width} / ${height}` }}>
          <Canvas
            shadows
            gl={{ preserveDrawingBuffer: true }}
            onCreated={({ gl }) => {
              toile.current = gl.domElement;
            }}
            className="!absolute inset-0"
          >
            <ViewOptions.Provider value={{ interactive: false, helpers: false }}>
              <ActiveCameraRig aspect={aspect} />
              <hemisphereLight args={['#ffffff', '#444444', hasLights ? 0.4 : 1.2]} />
              {!hasLights && <directionalLight position={[5, 8, 4]} intensity={1.5} castShadow />}
              <EntityChildren parentId={null} onRegistered={() => undefined} />
            </ViewOptions.Provider>
          </Canvas>
          <PhotoDuPlan />
          <BandeCameras />
          <VideoGrise source={toile} />
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
