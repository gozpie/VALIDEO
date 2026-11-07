'use client';

import type { AiProvider, GenerationJob } from '@ass/api-client';
import { Camera as CameraIcon, Film, Video } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, call, uploadProjectMedia } from '@/lib/api';
import { GenerateControl } from '@/studio/Generate';
import { useEditor, useEditorContext } from './context';
import { dimensions, enregistrerVueCamera } from './videoGrise';

const DEPART =
  '@image1 is a grey-box layout of the shot, from the exact camera to use. Keep its framing and ' +
  'perspective: every mass stays where it is, at the same size, and each plain mannequin marks where a ' +
  'character is. Create one photoreal frame. Never show the grey-box or the mannequins.';

interface Fiche {
  id: string;
  name: string;
  keyAssetId?: string | null;
}

/** Fiches du plan envoyées en référence par le serveur, dans le même ordre (@image2, @image3…). */
function useFichesDuPlan(shotId: string | undefined) {
  const [fiches, setFiches] = useState<Fiche[]>([]);
  const [description, setDescription] = useState({ image: '', video: '', negatif: '' });
  const [projectId, setProjectId] = useState<string | null>(null);
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
      if (!vivant) return;
      const liees = new Set(plan.bibleEntryIds ?? []);
      setFiches(bible.filter((e) => liees.has(e.id) && e.keyAssetId));
      setProjectId(plan.projectId);
      setDescription({
        image: plan.imagePrompt || plan.description || '',
        video: plan.videoPrompt || plan.description || '',
        negatif: plan.negativePrompt ?? '',
      });
    })().catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [shotId]);
  return { fiches, description, projectId };
}

/**
 * La chaîne du plateau gris : la vue de la caméra active et les fiches des personnages donnent une
 * image, validée à l'œil, qui sert ensuite de référence à la vidéo. Rien ne part sans confirmation
 * du coût (`GenerateControl`).
 */
export function GenerationCamera({
  providers,
  jobs,
  onSave,
  onCreated,
}: {
  providers: AiProvider[];
  jobs: GenerationJob[];
  onSave: () => Promise<boolean>;
  onCreated: (job: GenerationJob) => void;
}) {
  const { shotId, canEdit, store } = useEditorContext();
  const frame = useEditor((state) => state.frame);
  const camera = useEditor(
    (state) => state.scene.cameras.find((c) => c.id === state.scene.activeCameraId) ?? null,
  );
  const fps = useEditor((state) => state.scene.fps.numerator / state.scene.fps.denominator);
  const duree = useEditor((state) => state.scene.durationFrames);
  const largeur = useEditor((state) => state.scene.renderSettings.width);
  const hauteur = useEditor((state) => state.scene.renderSettings.height);
  const { fiches, description, projectId } = useFichesDuPlan(shotId);
  // Vidéo grise : le plateau rejoué dans la vue caméra, envoyée avec le projet.
  const [grise, setGrise] = useState<{ assetId: string; heure: string } | null>(null);
  const [progres, setProgres] = useState<number | null>(null);
  const [erreurGrise, setErreurGrise] = useState<string | null>(null);
  const [definition, setDefinition] = useState('');
  const [texteImage, setTexteImage] = useState<string | null>(null);
  const [texteVideo, setTexteVideo] = useState<string | null>(null);

  const noms = useMemo(
    () => fiches.map((fiche, rang) => `@image${rang + 2} is ${fiche.name}.`).join(' '),
    [fiches],
  );
  const scene = texteImage ?? description.image;
  const promptImage = [DEPART, noms, scene].filter(Boolean).join(' ');

  // Dernière image tirée d'une caméra du plateau : c'est elle qu'on anime.
  const image = jobs.find(
    (job) =>
      job.status === 'completed' &&
      (job.mode === 'text_to_image' || job.mode === 'image_to_image') &&
      Array.isArray(job.request['sceneFrames']) &&
      (job.request['sceneFrames'] as number[]).length > 0,
  );
  const sortie = (
    image?.outputs['assets'] as { assetId: string; versionId?: string }[] | undefined
  )?.[0];
  const mouvement = texteVideo ?? description.video;
  const promptVideo = [
    fiches.length > 0
      ? `@image${fiches.length + 1} is the validated frame: keep its framing, its people and its light.`
      : '@image1 is the validated frame: keep its framing, its people and its light.',
    fiches.map((fiche, rang) => `@image${rang + 1} is ${fiche.name}.`).join(' '),
    mouvement,
  ]
    .filter(Boolean)
    .join(' ');

  const cadre = `@image${fiches.length + 1}`;
  const promptGrise = [
    'Recreate @video1 exactly: same camera move, framing and timing.',
    `Turn the grey-box set into the place shown in ${cadre} and each grey mannequin into the ` +
      `matching person from ${cadre}, at the same spot and size.`,
    fiches.map((fiche, rang) => `@image${rang + 1} is ${fiche.name}.`).join(' '),
    mouvement,
    'Never show grey-box shapes or mannequins.',
  ]
    .filter(Boolean)
    .join(' ');

  const enregistrerGrise = async () => {
    const toile = document.querySelector<HTMLCanvasElement>('[data-testid="camera-view"] canvas');
    if (!toile) {
      setErreurGrise(
        'Affichez la vue caméra (Disposition des vues) pour enregistrer la vidéo grise.',
      );
      return;
    }
    if (!projectId) return;
    const depart = store.getState().frame;
    setErreurGrise(null);
    setProgres(0);
    try {
      const video = await enregistrerVueCamera({
        source: toile,
        frames: duree,
        fps,
        ...dimensions(largeur, hauteur),
        allerA: (f) => store.getState().setFrame(f),
        onProgres: (f) => setProgres(f + 1),
      });
      const extension = video.type.includes('mp4') ? 'mp4' : 'webm';
      const envoye = await uploadProjectMedia(
        projectId,
        new File([video], `video-grise.${extension}`, { type: video.type }),
      );
      setGrise({
        assetId: envoye.asset.id,
        heure: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      });
    } catch (e) {
      setErreurGrise(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      store.getState().setFrame(depart);
      setProgres(null);
    }
  };

  if (!shotId || !canEdit) return null;
  const champ =
    'resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-sm placeholder:text-faint focus:border-ai focus:outline-none';

  return (
    <section
      aria-label="Depuis la caméra"
      className="flex flex-col gap-2 rounded-lg border border-ai/40 bg-ai/5 p-2 text-xs"
    >
      <h3 className="flex items-center gap-1.5 font-semibold text-text">
        <CameraIcon size={13} /> Depuis {camera ? `« ${camera.name} »` : 'la caméra active'}
      </h3>
      <p className="text-muted">
        La vue de cette caméra
        {fiches.length > 0 ? ` et ${fiches.length} fiche(s) de la bible` : ''} guident l’image.
      </p>
      <textarea
        aria-label="Décrire l’image"
        rows={3}
        maxLength={3000}
        value={scene}
        placeholder="La scène : qui, où, ambiance, lumière…"
        onChange={(event) => setTexteImage(event.target.value)}
        className={champ}
      />
      <GenerateControl
        compact
        target={{ kind: 'shot', id: shotId }}
        providers={providers}
        mode="text_to_image"
        defaultModel="higgsfield:gpt_image_2_5"
        label="Générer l’image depuis cette caméra"
        disabled={!camera || scene.trim() === ''}
        avant={onSave}
        body={{
          prompt: promptImage,
          negativePrompt: description.negatif,
          sceneFrames: [frame],
          bibleReferences: true,
          aspectRatio: '16:9',
          // Un guide se vérifie d'abord en petit : le moins cher, 1K en qualité basse.
          options: { resolution: '1k' },
        }}
        onCreated={onCreated}
      />
      {sortie && (
        <>
          <h3 className="mt-1 flex items-center gap-1.5 font-semibold text-text">
            <Film size={13} /> Animer la dernière image
          </h3>
          <textarea
            aria-label="Décrire le mouvement"
            rows={2}
            maxLength={3000}
            value={mouvement}
            placeholder="Le mouvement : ce qui se passe pendant le plan…"
            onChange={(event) => setTexteVideo(event.target.value)}
            className={champ}
          />
          <GenerateControl
            compact
            target={{ kind: 'shot', id: shotId }}
            providers={providers}
            mode="image_to_video"
            defaultModel="higgsfield:seedance_2_5"
            label="Animer cette image"
            disabled={mouvement.trim() === ''}
            body={{
              prompt: promptVideo,
              negativePrompt: description.negatif,
              bibleReferences: true,
              referenceAssetIds: [sortie.assetId],
              durationSeconds: Math.max(1, Math.round(duree / fps)),
              aspectRatio: '16:9',
              ...(sortie.versionId ? { parentVersionId: sortie.versionId } : {}),
            }}
            onCreated={onCreated}
          />
          <h3 className="mt-1 flex items-center gap-1.5 font-semibold text-text">
            <Video size={13} /> Animer avec la vidéo grise
          </h3>
          <p className="text-muted">
            Le plateau est rejoué dans la vue caméra : le modèle reprend son mouvement de caméra,
            ses places et son rythme, avec le rendu de cette image.
          </p>
          <button
            type="button"
            disabled={progres !== null}
            onClick={() => void enregistrerGrise()}
            className="self-start rounded-md border border-border px-2 py-1 hover:border-ai disabled:opacity-60"
          >
            {progres !== null
              ? `Enregistrement ${progres}/${duree}`
              : grise
                ? `Réenregistrer la vidéo grise (actuelle : ${grise.heure})`
                : 'Enregistrer la vidéo grise'}
          </button>
          {erreurGrise && <p className="text-red-400">{erreurGrise}</p>}
          {grise && (
            <>
              <label className="flex items-center gap-2 text-muted">
                Définition
                <select
                  aria-label="Définition de la vidéo"
                  value={definition}
                  onChange={(event) => setDefinition(event.target.value)}
                  className="rounded bg-surface px-1"
                >
                  <option value="">la moins chère du modèle</option>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </label>
              <GenerateControl
                compact
                target={{ kind: 'shot', id: shotId }}
                providers={providers}
                mode="image_to_video"
                controle="camera_motion"
                defaultModel="higgsfield:genjutsu_lite"
                label="Animer avec la vidéo grise"
                body={{
                  prompt: promptGrise,
                  negativePrompt: description.negatif,
                  bibleReferences: true,
                  referenceAssetIds: [sortie.assetId],
                  motionVideoAssetId: grise.assetId,
                  durationSeconds: Math.max(1, Math.round(duree / fps)),
                  aspectRatio: '16:9',
                  ...(definition ? { options: { resolution: definition } } : {}),
                  ...(sortie.versionId ? { parentVersionId: sortie.versionId } : {}),
                }}
                onCreated={onCreated}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
