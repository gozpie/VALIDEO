'use client';

import type { PrimitiveKind } from '@ass/scene-schema';
import {
  CAMERAS_PLATEAU,
  MOUVEMENTS,
  PRIMITIVE_LABELS,
  addCameraPlateau,
  addMannequin,
  createCamera,
  createEmptyNode,
  createGroupNode,
  createLight,
  createModelNode,
  createPrimitiveNode,
  mouvementCamera,
  type TypeMouvement,
} from '@ass/scene-engine';
import { useEffect, useRef, useState } from 'react';
import { api, call, uploadAsset } from '@/lib/api';
import { toast } from '@/lib/toast';
import { addAndSelect } from './commands';
import { useEditorContext } from './context';

const PRIMITIVES = Object.keys(PRIMITIVE_LABELS) as PrimitiveKind[];

/** Noms des personnages de la bible du projet : chacun a sa doublure en un clic. */
function usePersonnages(shotId: string | undefined): string[] {
  const [noms, setNoms] = useState<string[]>([]);
  useEffect(() => {
    if (!shotId) return undefined;
    let vivant = true;
    void (async () => {
      const plan = await call(
        api.GET('/shots/{shot_id}', { params: { path: { shot_id: shotId } } }),
      );
      const bible = await call(
        api.GET('/projects/{project_id}/bible', {
          params: { path: { project_id: plan.projectId } },
        }),
      );
      if (vivant) setNoms(bible.filter((e) => e.kind === 'character').map((e) => e.name));
    })().catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [shotId]);
  return noms;
}

export function AddMenu({
  workspaceId,
  onSave,
  formesOuvertes = false,
}: {
  workspaceId: string;
  /** Enregistre la scène (Claude lit la révision enregistrée). */
  onSave?: () => Promise<boolean>;
  /** Le menu flottant (Maj+A) montre tout de suite les formes simples. */
  formesOuvertes?: boolean;
}) {
  const { store, shotId } = useEditorContext();
  const personnages = usePersonnages(shotId);
  const [assis, setAssis] = useState(false);
  const mannequin = (nom: string) => {
    let id: string | null = null;
    const pose = store.getState().apply((scene) => {
      const resultat = addMannequin(scene, nom, assis ? 'assis' : 'debout');
      id = resultat.id;
      return resultat.scene;
    });
    if (pose && id) store.getState().select([id]);
  };
  const cameraPlateau = (preset: (typeof CAMERAS_PLATEAU)[number]['id']) => {
    const etat = store.getState();
    const selection = etat.selection.find((id) => etat.scene.nodes.some((n) => n.id === id));
    etat.apply((scene) => addCameraPlateau(scene, preset, selection ?? null).scene);
    store.getState().setCameraView('camera');
  };
  // Mouvement de la caméra active, centré sur l'objet sélectionné s'il y en a un.
  const [mouvement, setMouvement] = useState<TypeMouvement>('travelling_avant');
  const [amplitude, setAmplitude] = useState(MOUVEMENTS.travelling_avant.amplitude);
  const appliquerMouvement = () => {
    const etat = store.getState();
    const cameraId = etat.scene.activeCameraId;
    if (!cameraId) {
      toast('Aucune caméra active : ajoutez une caméra du plateau', { kind: 'error' });
      return;
    }
    const cible = etat.selection.find((id) => etat.scene.nodes.some((n) => n.id === id)) ?? null;
    try {
      etat.apply((scene) =>
        mouvementCamera(scene, cameraId, { type: mouvement, amplitude, cibleId: cible }),
      );
      store.getState().setCameraView('camera');
    } catch (error) {
      toast((error as Error).message, { kind: 'error' });
    }
  };
  // Décor décrit en une phrase : Claude propose les volumes, appliqués depuis « Résultats ».
  const [decor, setDecor] = useState('');
  const [decorEnCours, setDecorEnCours] = useState(false);
  const construireDecor = async () => {
    if (!shotId || !onSave || decor.trim() === '') return;
    setDecorEnCours(true);
    try {
      if (!(await onSave())) return;
      const moteurs = await call(api.GET('/ai/providers'));
      const claude = moteurs.find((p) => p.id === 'claude' && p.available);
      if (!claude) throw new Error('Claude est indisponible pour le moment');
      const etat = store.getState();
      await call(
        api.POST('/shots/{shot_id}/generations', {
          params: { path: { shot_id: shotId } },
          body: {
            provider: 'claude',
            model: claude.models.some((m) => m.model === 'sonnet')
              ? 'sonnet'
              : (claude.models[0]?.model ?? 'sonnet'),
            mode: 'scene_from_text',
            prompt:
              'Construis le décor du plateau gris en volumes simples, couleurs neutres, sans lumière ' +
              'ni caméra, sans toucher aux mannequins ni à la caméra existante. ' +
              decor.trim(),
            sceneFrames: etat.scene.activeCameraId ? [etat.frame] : [],
          },
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }),
      );
      window.dispatchEvent(new Event('chagomi:generations'));
      toast('Claude prépare le décor : sa proposition arrive dans l’onglet IA, « Résultats »', {
        kind: 'ai',
      });
    } catch (error) {
      toast((error as Error).message, { kind: 'error' });
    } finally {
      setDecorEnCours(false);
    }
  };
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'error'; message?: string }>({
    kind: 'idle',
  });
  const button =
    'rounded-md border border-border bg-surface px-2 py-1 text-xs text-text/90 transition-colors hover:border-border-strong hover:bg-hover disabled:opacity-50';

  const titre = 'text-[11px] font-semibold uppercase tracking-wider text-faint';
  const puce = (actif: boolean) =>
    `${button} ${actif ? '!border-accent !bg-accent !text-white' : ''}`;

  return (
    <section aria-label="Ajouter" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className={titre}>Personnages</h2>
        <div className="flex flex-wrap items-center gap-1">
          {(personnages.length > 0 ? personnages : ['Personnage']).map((nom) => (
            <button key={nom} type="button" className={button} onClick={() => mannequin(nom)}>
              Mannequin {nom}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Pose" className="flex gap-1">
          <button
            type="button"
            aria-pressed={!assis}
            className={puce(!assis)}
            onClick={() => setAssis(false)}
          >
            Debout
          </button>
          <button
            type="button"
            aria-pressed={assis}
            className={puce(assis)}
            onClick={() => setAssis(true)}
          >
            Assis
          </button>
        </div>
        <p className="text-[11px] text-faint">
          Un mannequin par personnage. Son nez montre où il regarde.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className={titre}>Cadrage</h2>
        <div className="flex flex-wrap gap-1">
          {CAMERAS_PLATEAU.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={button}
              title={`Caméra ${preset.focale} mm cadrée sur le mannequin sélectionné`}
              onClick={() => cameraPlateau(preset.id)}
            >
              {preset.nom}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className={titre}>Mouvement de caméra</h2>
        <div
          role="group"
          aria-label="Mouvement de caméra"
          className="flex flex-wrap items-center gap-1"
        >
          <select
            aria-label="Mouvement"
            value={mouvement}
            onChange={(event) => {
              const type = event.target.value as TypeMouvement;
              setMouvement(type);
              setAmplitude(MOUVEMENTS[type].amplitude);
            }}
            className="h-7 rounded-md border border-border bg-surface px-1 text-xs"
          >
            {(Object.keys(MOUVEMENTS) as TypeMouvement[]).map((type) => (
              <option key={type} value={type}>
                {MOUVEMENTS[type].label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted">
            <input
              type="number"
              aria-label="Amplitude du mouvement"
              value={amplitude}
              step={MOUVEMENTS[mouvement].unite === '°' ? 5 : 0.1}
              onChange={(event) => setAmplitude(Number(event.target.value))}
              className="h-7 w-16 rounded-md border border-border bg-surface px-1"
            />
            {MOUVEMENTS[mouvement].unite}
          </label>
          <button
            type="button"
            className={button}
            title="Sur tout le plan, depuis le cadrage actuel ; centré sur l’objet sélectionné s’il y en a un"
            onClick={appliquerMouvement}
          >
            Appliquer à la caméra active
          </button>
        </div>
        <p className="text-[11px] text-faint">
          Sur tout le plan, à partir du cadrage. Garde l’objet sélectionné au centre.
        </p>
      </div>
      {onSave && (
        <div className="flex flex-col gap-1.5">
          <h2 className={titre}>Décor</h2>
          <textarea
            aria-label="Décrire le décor"
            rows={3}
            value={decor}
            maxLength={2000}
            placeholder="Ex. : bureau, bibliothèque à gauche, grande fenêtre sur la mer à droite"
            onChange={(event) => setDecor(event.target.value)}
            className="resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-xs placeholder:text-faint focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            className={button}
            disabled={decorEnCours || decor.trim() === ''}
            onClick={() => void construireDecor()}
          >
            {decorEnCours ? 'Envoi à Claude…' : 'Construire le décor avec Claude'}
          </button>
        </div>
      )}
      <details open={formesOuvertes} className="border-t border-border pt-2">
        <summary className="cursor-pointer select-none text-xs text-muted hover:text-text">
          Formes simples : cube, sphère, lumière, modèle GLB…
        </summary>
        <div className="mt-2 flex flex-wrap gap-1">
          {PRIMITIVES.map((kind) => (
            <button
              key={kind}
              type="button"
              className={button}
              onClick={() =>
                addAndSelect(store, { kind: 'node', value: createPrimitiveNode(kind) })
              }
            >
              {PRIMITIVE_LABELS[kind]}
            </button>
          ))}
          <button
            type="button"
            className={button}
            onClick={() => addAndSelect(store, { kind: 'node', value: createEmptyNode() })}
          >
            Empty
          </button>
          <button
            type="button"
            className={button}
            onClick={() => addAndSelect(store, { kind: 'node', value: createGroupNode() })}
          >
            Groupe
          </button>
          <button
            type="button"
            className={button}
            onClick={() => addAndSelect(store, { kind: 'camera', value: createCamera() })}
          >
            Caméra
          </button>
          <button
            type="button"
            className={button}
            onClick={() =>
              addAndSelect(store, { kind: 'light', value: createLight('directional') })
            }
          >
            Lumière directionnelle
          </button>
          <button
            type="button"
            className={button}
            onClick={() => addAndSelect(store, { kind: 'light', value: createLight('point') })}
          >
            Lumière ponctuelle
          </button>
          <button
            type="button"
            className={button}
            onClick={() => addAndSelect(store, { kind: 'light', value: createLight('spot') })}
          >
            Projecteur
          </button>
          <button
            type="button"
            className={button}
            disabled={status.kind === 'busy'}
            onClick={() => input.current?.click()}
          >
            {status.kind === 'busy' ? 'Import…' : 'Importer un GLB'}
          </button>
          <input
            ref={input}
            type="file"
            accept=".glb,model/gltf-binary"
            aria-label="Fichier GLB à importer"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setStatus({ kind: 'busy' });
              uploadAsset(workspaceId, file)
                .then(({ asset }) => {
                  const name = asset.name.replace(/\.glb$/i, '').slice(0, 200) || 'Modèle';
                  addAndSelect(store, { kind: 'node', value: createModelNode(asset.id, name) });
                  setStatus({ kind: 'idle' });
                })
                .catch((error: Error) => setStatus({ kind: 'error', message: error.message }));
            }}
          />
        </div>
      </details>
      {status.kind === 'error' && (
        <p role="alert" className="text-xs text-error">
          {status.message}
        </p>
      )}
    </section>
  );
}
