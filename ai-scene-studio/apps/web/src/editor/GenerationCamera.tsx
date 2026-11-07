'use client';

import type { AiProvider, GenerationInput, GenerationJob } from '@ass/api-client';
import { useEffect, useMemo, useState } from 'react';
import { api, call, uploadProjectMedia } from '@/lib/api';
import { GenerateControl, estimate } from '@/studio/Generate';
import { useEditor, useEditorContext } from './context';
import { dimensions, enregistrerVueCamera } from './videoGrise';

const DEPART =
  '@image1 is a grey-box layout of the shot, from the exact camera to use. Keep its framing and ' +
  'perspective: every mass stays where it is, at the same size, and each plain mannequin marks where a ' +
  'character is. Create one photoreal frame. Never show the grey-box or the mannequins.';

/** Trois qualités au lieu d'un moteur : le moteur et la définition suivent. */
type Qualite = 'essai' | 'bon' | 'final';
const QUALITES: { id: Qualite; label: string }[] = [
  { id: 'essai', label: 'Essai' },
  { id: 'bon', label: 'Bon' },
  { id: 'final', label: 'Final' },
];
const MOTEURS: Record<
  'plateau' | 'libre',
  Record<Qualite, { model: string; resolution: string }>
> = {
  // Avec la vidéo grise : modèles qui reprennent le mouvement du plateau.
  plateau: {
    essai: { model: 'higgsfield:genjutsu_lite', resolution: '720p' },
    bon: { model: 'higgsfield:kling4_0', resolution: '720p' },
    final: { model: 'higgsfield:kling4_0', resolution: '1080p' },
  },
  libre: {
    essai: { model: 'higgsfield:seedance_2_5', resolution: '480p' },
    bon: { model: 'higgsfield:seedance_2_5', resolution: '720p' },
    final: { model: 'higgsfield:seedance_2_5', resolution: '1080p' },
  },
};

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

/** Attend que la vue caméra soit affichée (son canvas WebGL), au plus 3 s. */
async function toileCamera(): Promise<HTMLCanvasElement | null> {
  for (let i = 0; i < 60; i += 1) {
    const toile = document.querySelector<HTMLCanvasElement>('[data-testid="camera-view"] canvas');
    if (toile) return toile;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

/** Une étape numérotée : verte une fois faite, bleue quand c'est son tour. */
export function Etape({
  numero,
  titre,
  etat,
  faite,
  active,
  children,
}: {
  numero: number;
  titre: string;
  etat?: string | undefined;
  faite?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={`Étape ${numero} — ${titre}`}
      className={`flex flex-col gap-2 rounded-lg border bg-surface/60 p-2.5 text-xs ${faite ? 'border-ok/50' : active ? 'border-accent/60' : 'border-border'}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${faite ? 'bg-ok text-black' : active ? 'bg-accent text-white' : 'bg-border text-muted'}`}
        >
          {numero}
        </span>
        <h3 className="flex-1 text-sm font-semibold text-text">{titre}</h3>
        {etat && <span className="text-[11px] text-faint">{etat}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * Faire le plan : l'image (cadrée par la caméra du plateau), puis la vidéo ; les résultats suivent
 * dans le panneau IA. Le moteur se choisit par une qualité ; la vidéo grise s'enregistre d'elle-même
 * quand la vidéo suit le plateau. Rien ne part sans confirmation du coût (`GenerateControl`).
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
  const { shotId, canEdit, store, assetUrl } = useEditorContext();
  const frame = useEditor((state) => state.frame);
  const camera = useEditor(
    (state) => state.scene.cameras.find((c) => c.id === state.scene.activeCameraId) ?? null,
  );
  const cameraAnimee = useEditor((state) =>
    state.scene.animations.some(
      (t) => t.targetId === state.scene.activeCameraId && t.propertyPath.startsWith('transform.'),
    ),
  );
  const fps = useEditor((state) => state.scene.fps.numerator / state.scene.fps.denominator);
  const duree = useEditor((state) => state.scene.durationFrames);
  const largeur = useEditor((state) => state.scene.renderSettings.width);
  const hauteur = useEditor((state) => state.scene.renderSettings.height);
  const { fiches, description, projectId } = useFichesDuPlan(shotId);
  const [texteImage, setTexteImage] = useState<string | null>(null);
  const [texteVideo, setTexteVideo] = useState<string | null>(null);
  const [gardee, setGardee] = useState<string | null>(null);
  const [suivre, setSuivre] = useState(true);
  const [qualite, setQualite] = useState<Qualite>('essai');
  const [occupe, setOccupe] = useState<string | null>(null);
  const [prix, setPrix] = useState<Partial<Record<Qualite, string>>>({});

  const secondes = Math.max(1, Math.round(duree / fps));
  const noms = useMemo(
    () => fiches.map((fiche, rang) => `@image${rang + 2} is ${fiche.name}.`).join(' '),
    [fiches],
  );
  const scene = texteImage ?? description.image;
  const promptImage = [DEPART, noms, scene].filter(Boolean).join(' ');

  // Images tirées d'une caméra du plateau, la plus récente d'abord : on en garde une.
  const images = useMemo(
    () =>
      jobs
        .filter(
          (job) =>
            job.status === 'completed' &&
            (job.mode === 'text_to_image' || job.mode === 'image_to_image') &&
            Array.isArray(job.request['sceneFrames']) &&
            (job.request['sceneFrames'] as number[]).length > 0,
        )
        .flatMap(
          (job) =>
            (job.outputs['assets'] as { assetId: string; versionId?: string }[] | undefined) ?? [],
        )
        .slice(0, 4),
    [jobs],
  );
  const choisie = images.find((image) => image.assetId === gardee) ?? images[0] ?? null;

  const cadre = `@image${fiches.length + 1}`;
  const mouvement = texteVideo ?? description.video;
  const personnes = fiches.map((fiche, rang) => `@image${rang + 1} is ${fiche.name}.`).join(' ');
  const promptVideo = (
    suivre
      ? [
          'Recreate @video1 exactly: same camera move, framing and timing.',
          `Turn the grey-box set into the place shown in ${cadre} and each grey mannequin into the ` +
            `matching person from ${cadre}, at the same spot and size.`,
          personnes,
          mouvement,
          'Never show grey-box shapes or mannequins.',
        ]
      : [
          `${cadre} is the validated frame: keep its framing, its people and its light.`,
          personnes,
          mouvement,
        ]
  )
    .filter(Boolean)
    .join(' ');
  const moteur = MOTEURS[suivre ? 'plateau' : 'libre'][qualite];

  // Prix des trois qualités, demandés au serveur (même calcul que la confirmation).
  const imageId = choisie?.assetId ?? null;
  useEffect(() => {
    if (!shotId || !imageId) return undefined;
    let vivant = true;
    const table = MOTEURS[suivre ? 'plateau' : 'libre'];
    void Promise.all(
      QUALITES.map(async ({ id }) => {
        const { model, resolution } = table[id];
        const [provider = '', modele = ''] = model.split(':');
        const corps: GenerationInput = {
          provider,
          model: modele,
          mode: 'image_to_video',
          prompt: 'x',
          referenceAssetIds: [imageId],
          durationSeconds: secondes,
          aspectRatio: '16:9',
          options: { resolution },
        };
        try {
          const devis = await estimate({ kind: 'shot', id: shotId }, corps);
          if (!devis.available) return [id, 'indisponible'] as const;
          const montant = `${devis.amount.toLocaleString('fr-FR')} crédits`;
          return [
            id,
            devis.basis.includes('gratuit') ? `offert, sinon ${montant}` : montant,
          ] as const;
        } catch {
          return [id, '—'] as const;
        }
      }),
    ).then((liste) => {
      if (vivant) setPrix(Object.fromEntries(liste));
    });
    return () => {
      vivant = false;
    };
  }, [shotId, imageId, suivre, secondes]);

  /** La vidéo grise, enregistrée au moment d'envoyer : rien à préparer à la main. */
  const preparerVideoGrise = async (): Promise<boolean | Partial<GenerationInput>> => {
    if (!(await onSave()) || !projectId) return false;
    const etat = store.getState();
    const vue = etat.cameraView;
    const depart = etat.frame;
    if (vue === 'free') etat.setCameraView('camera');
    try {
      const toile = await toileCamera();
      if (!toile) throw new Error('La vue caméra ne s’affiche pas : choisissez une caméra active.');
      setOccupe('Vidéo grise…');
      const video = await enregistrerVueCamera({
        source: toile,
        frames: duree,
        fps,
        ...dimensions(largeur, hauteur),
        allerA: (f) => store.getState().setFrame(f),
        onProgres: (f) => setOccupe(`Vidéo grise ${f + 1}/${duree}`),
      });
      setOccupe('Envoi de la vidéo grise…');
      const extension = video.type.includes('mp4') ? 'mp4' : 'webm';
      const envoye = await uploadProjectMedia(
        projectId,
        new File([video], `video-grise.${extension}`, { type: video.type }),
      );
      return { motionVideoAssetId: envoye.asset.id };
    } finally {
      store.getState().setFrame(depart);
      if (vue === 'free') store.getState().setCameraView(vue);
      setOccupe(null);
    }
  };

  if (!shotId || !canEdit) return null;
  const champ =
    'resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-sm placeholder:text-faint focus:border-accent focus:outline-none';

  return (
    <>
      <Etape
        numero={1}
        titre="Image"
        etat={choisie ? 'gardée' : 'à faire'}
        faite={!!choisie}
        active={!choisie}
      >
        <p className="text-muted">
          Cadrée par {camera ? `« ${camera.name} »` : 'la caméra active'}
          {fiches.length > 0 ? `, avec ${fiches.length} fiche(s) de la bible` : ''}.
        </p>
        <textarea
          aria-label="Décrire la scène"
          rows={3}
          maxLength={3000}
          value={scene}
          placeholder="Qui, où, ambiance, lumière…"
          onChange={(event) => setTexteImage(event.target.value)}
          className={champ}
        />
        {images.length > 0 && (
          <div role="group" aria-label="Images du plan" className="grid grid-cols-2 gap-1.5">
            {images.map((image, rang) => {
              const active = image.assetId === choisie?.assetId;
              return (
                <button
                  key={image.assetId}
                  type="button"
                  aria-pressed={active}
                  aria-label={`Garder l’image ${rang + 1}`}
                  onClick={() => setGardee(image.assetId)}
                  className={`relative overflow-hidden rounded-md border-2 ${active ? 'border-ok' : 'border-transparent hover:border-border'}`}
                >
                  <img
                    src={assetUrl(image.assetId)}
                    alt=""
                    className="aspect-video w-full bg-black object-cover"
                  />
                  <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 text-[10px] text-white">
                    {active ? '✓ Gardée' : `Image ${rang + 1}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <GenerateControl
          simple
          compact
          target={{ kind: 'shot', id: shotId }}
          providers={providers}
          mode="text_to_image"
          defaultModel="higgsfield:gpt_image_2_5"
          label={images.length > 0 ? 'Nouvelle image' : 'Créer l’image'}
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
      </Etape>

      <Etape
        numero={2}
        titre="Vidéo"
        etat={choisie ? 'à faire' : 'après l’image'}
        active={!!choisie}
      >
        {choisie ? (
          <>
            <p className="rounded-md border border-border bg-surface px-2 py-1.5 text-text/90">
              Caméra {cameraAnimee ? 'en mouvement' : 'fixe'} · {secondes} s
              <span className="block text-[11px] text-faint">
                Le mouvement se règle à gauche, dans « Mouvement de caméra ».
              </span>
            </p>
            <label className="flex items-start gap-2 text-text/90">
              <input
                type="checkbox"
                checked={suivre}
                onChange={(event) => setSuivre(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Suivre le plateau
                <span className="block text-[11px] text-faint">
                  La vidéo reprend le mouvement de caméra et les places du plateau.
                </span>
              </span>
            </label>
            <textarea
              aria-label="Ce qui se passe"
              rows={2}
              maxLength={3000}
              value={mouvement}
              placeholder="Ce qui se passe pendant le plan…"
              onChange={(event) => setTexteVideo(event.target.value)}
              className={champ}
            />
            <div role="radiogroup" aria-label="Qualité" className="grid grid-cols-3 gap-1.5">
              {QUALITES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={qualite === id}
                  onClick={() => setQualite(id)}
                  className={`flex flex-col items-start rounded-md border px-2 py-1.5 text-left ${qualite === id ? 'border-accent bg-accent text-white' : 'border-border bg-surface hover:border-border-strong'}`}
                >
                  <b className="text-xs">{label}</b>
                  <span
                    className={`text-[10px] ${qualite === id ? 'text-white/85' : 'text-faint'}`}
                  >
                    {prix[id] ?? '…'}
                  </span>
                </button>
              ))}
            </div>
            <GenerateControl
              key={`${suivre}-${qualite}`}
              simple
              compact
              target={{ kind: 'shot', id: shotId }}
              providers={providers}
              mode="image_to_video"
              {...(suivre ? { controle: 'camera_motion' } : {})}
              defaultModel={moteur.model}
              label="Créer la vidéo"
              disabled={mouvement.trim() === '' && !suivre}
              avant={suivre ? preparerVideoGrise : onSave}
              occupe={occupe}
              body={{
                prompt: promptVideo,
                negativePrompt: description.negatif,
                bibleReferences: true,
                referenceAssetIds: [choisie.assetId],
                durationSeconds: secondes,
                aspectRatio: '16:9',
                options: { resolution: moteur.resolution },
                ...(choisie.versionId ? { parentVersionId: choisie.versionId } : {}),
              }}
              onCreated={onCreated}
            />
            <details className="text-[11px] text-faint">
              <summary className="cursor-pointer select-none hover:text-muted">
                Texte envoyé au moteur
              </summary>
              <p className="mt-1 rounded-md bg-panel p-2 font-mono leading-relaxed text-text/80">
                {promptVideo}
              </p>
            </details>
          </>
        ) : (
          <p className="text-muted">
            Créez puis gardez une image : elle donne le rendu de la vidéo.
          </p>
        )}
      </Etape>
    </>
  );
}
