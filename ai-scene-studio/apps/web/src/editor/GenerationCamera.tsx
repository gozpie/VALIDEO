'use client';

import type { AiProvider, GenerationJob } from '@ass/api-client';
import { Camera as CameraIcon, Film } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, call } from '@/lib/api';
import { GenerateControl } from '@/studio/Generate';
import { useEditor, useEditorContext } from './context';

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
  return { fiches, description };
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
  const { shotId, canEdit } = useEditorContext();
  const frame = useEditor((state) => state.frame);
  const camera = useEditor(
    (state) => state.scene.cameras.find((c) => c.id === state.scene.activeCameraId) ?? null,
  );
  const fps = useEditor((state) => state.scene.fps.numerator / state.scene.fps.denominator);
  const duree = useEditor((state) => state.scene.durationFrames);
  const { fiches, description } = useFichesDuPlan(shotId);
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
        </>
      )}
    </section>
  );
}
