/**
 * Le film : lien entre les plans du studio et le montage.
 *
 * Le montage appartient au monteur : une synchronisation n'y touche que ce qui a changé dans le
 * studio. Un plan jamais vu entre dans le film à sa place ; un plan dont le média a changé voit ses
 * clips remplacés, sans bouger ; un clip retiré à la main n'est pas remis d'office. Fonctions pures,
 * sans navigateur : elles reçoivent et rendent une séquence.
 */
import { createClip, createProject, createSequence } from '@valideo/project-model';
import type { ClipDoc, MediaAssetDoc, ProjectDoc, SequenceDoc } from '@valideo/project-model';
import { newLinkGroupId } from '@valideo/shared';
import { rational, timebase } from '@valideo/time-core';
import { clipEnd, insert, overwrite, sourceFramesUsed } from '@valideo/timeline-model';
import type { SourceInfo, TimelineContext } from '@valideo/timeline-model';
import { dureeSurTimeline, estImageFixe } from './media/placement';
import { timebaseDeSequence } from './timeline/draw';

export interface PlanDuFilm {
  readonly shotId: string;
  readonly label: string;
  readonly name: string;
  readonly sequence: string;
  readonly status: string;
  readonly seconds: number;
  readonly media: {
    readonly assetId: string;
    readonly kind: string;
    readonly mimeType: string;
    readonly versionNumber: number;
    readonly retained: boolean;
  } | null;
}

export interface LiensFilm {
  /** Média du document → fichier conservé par le serveur (et plan d'origine, s'il en a un). */
  readonly media: Readonly<
    Record<string, { assetId: string; shotId: string | null; mimeType: string }>
  >;
  /** Plan → dernier fichier monté (`null` : le plan attendait encore son image). */
  readonly shots: Readonly<Record<string, { assetId: string | null }>>;
  /** Clip d'attente → plan qu'il représente, le temps que ce plan existe. */
  readonly attentes: Readonly<Record<string, string>>;
}

export const LIENS_VIDES: LiensFilm = { media: {}, shots: {}, attentes: {} };

export function lireLiens(brut: Record<string, unknown>): LiensFilm {
  return {
    media: (brut['media'] ?? {}) as LiensFilm['media'],
    shots: (brut['shots'] ?? {}) as LiensFilm['shots'],
    attentes: (brut['attentes'] ?? {}) as LiensFilm['attentes'],
  };
}

export const COULEUR_ATTENTE = '#5d6575';

export function documentInitial(options: {
  readonly projectId: string;
  readonly name: string;
  readonly fps: { readonly numerator: number; readonly denominator: number };
  readonly width: number;
  readonly height: number;
}): ProjectDoc {
  const projet = createProject(options.name);
  const sequence = createSequence(options.name, {
    timebase: timebase(rational(options.fps.numerator, options.fps.denominator)),
    videoTracks: 2,
    audioTracks: 3,
    settings: { width: options.width, height: options.height },
  });
  return {
    ...projet,
    id: options.projectId as ProjectDoc['id'],
    sequences: [sequence],
    activeSequenceId: sequence.id,
  };
}

export function contexteFilm(
  sequence: SequenceDoc,
  medias: readonly MediaAssetDoc[],
): TimelineContext {
  const parId = new Map(medias.map((m) => [m.id, m]));
  return {
    timebase: timebaseDeSequence(sequence),
    resolveSource: (clip): SourceInfo | null => {
      if (clip.mediaId === null) return null;
      const asset = parId.get(clip.mediaId);
      if (asset === undefined) return null;
      return {
        first: 0,
        count: asset.duration.frames,
        rate: rational(asset.duration.base.rate.n, asset.duration.base.rate.d),
      };
    },
  };
}

export interface BesoinMedia {
  readonly shotId: string;
  readonly assetId: string;
  readonly mimeType: string;
  readonly nom: string;
}

function mediaDuPlan(liens: LiensFilm, shotId: string, assetId: string): string | null {
  for (const [id, lien] of Object.entries(liens.media)) {
    if (lien.shotId === shotId && lien.assetId === assetId) return id;
  }
  return null;
}

/** Fichiers à récupérer avant de synchroniser : plans nouveaux, plans dont le média a changé. */
export function mediasManquants(
  plans: readonly PlanDuFilm[],
  liens: LiensFilm,
): readonly BesoinMedia[] {
  const besoins: BesoinMedia[] = [];
  for (const plan of plans) {
    if (plan.media === null) continue;
    if (liens.shots[plan.shotId]?.assetId === plan.media.assetId) continue;
    if (mediaDuPlan(liens, plan.shotId, plan.media.assetId) !== null) continue;
    besoins.push({
      shotId: plan.shotId,
      assetId: plan.media.assetId,
      mimeType: plan.media.mimeType,
      nom: `${plan.label} v${plan.media.versionNumber}`,
    });
  }
  return besoins;
}

export interface MediaRecu extends BesoinMedia {
  readonly asset: MediaAssetDoc;
}

/** Plan d'origine d'un clip, s'il en a un. */
export function planDuClip(clip: ClipDoc, liens: LiensFilm): string | null {
  const attente = liens.attentes[clip.id];
  if (attente !== undefined) return attente;
  if (clip.mediaId === null) return null;
  return liens.media[clip.mediaId]?.shotId ?? null;
}

function clipsDuPlan(sequence: SequenceDoc, shotId: string, liens: LiensFilm): readonly ClipDoc[] {
  return sequence.tracks.flatMap((t) => t.clips.filter((c) => planDuClip(c, liens) === shotId));
}

/** Clips du plan sur les pistes vidéo, dans l'ordre : ce sont eux qui disent où est le plan. */
export function clipsImageDuPlan(
  sequence: SequenceDoc,
  shotId: string,
  liens: LiensFilm,
): readonly ClipDoc[] {
  return sequence.tracks
    .filter((t) => t.kind === 'video')
    .flatMap((t) => t.clips.filter((c) => planDuClip(c, liens) === shotId))
    .sort((a, b) => a.start - b.start);
}

function aDuSon(asset: MediaAssetDoc): boolean {
  return asset.audioStreams.length > 0;
}

/** Durée d'un plan sur la timeline : celle du découpage, sans dépasser ce que le média contient. */
function dureePlan(plan: PlanDuFilm, asset: MediaAssetDoc | null, sequence: SequenceDoc): number {
  const base = timebaseDeSequence(sequence);
  const prevue = Math.max(1, Math.round((plan.seconds * base.rate.n) / base.rate.d));
  if (asset === null || estImageFixe(asset)) return prevue;
  return Math.min(prevue, dureeSurTimeline(asset, sequence));
}

function remplacerClip(sequence: SequenceDoc, ancien: ClipDoc, nouveau: ClipDoc): SequenceDoc {
  return {
    ...sequence,
    tracks: sequence.tracks.map((t) =>
      t.id === ancien.trackId
        ? { ...t, clips: t.clips.map((c) => (c.id === ancien.id ? nouveau : c)) }
        : t,
    ),
  };
}

function retirerClip(sequence: SequenceDoc, clip: ClipDoc): SequenceDoc {
  return {
    ...sequence,
    tracks: sequence.tracks.map((t) =>
      t.id === clip.trackId ? { ...t, clips: t.clips.filter((c) => c.id !== clip.id) } : t,
    ),
  };
}

/** Le clip sur son nouveau média : même place, et jamais plus long que ce que le média fournit. */
function surNouveauMedia(
  clip: ClipDoc,
  asset: MediaAssetDoc,
  nom: string,
  ctx: TimelineContext,
): ClipDoc {
  const base: ClipDoc = {
    ...clip,
    kind: clip.kind === 'audio' ? 'audio' : 'video',
    mediaId: asset.id,
    name: nom,
    label: clip.label === COULEUR_ATTENTE ? null : clip.label,
  };
  if (estImageFixe(asset)) return { ...base, sourceIn: 0 };
  const disponibles = asset.duration.frames;
  const utilisees = sourceFramesUsed({ ...base, sourceIn: 0 }, ctx);
  if (utilisees > disponibles) {
    const duree = Math.max(1, Math.floor((clip.duration * disponibles) / utilisees));
    return { ...base, sourceIn: 0, duration: duree };
  }
  return { ...base, sourceIn: Math.min(clip.sourceIn, disponibles - utilisees) };
}

function pisteLibre(sequence: SequenceDoc, trackId: string, debut: number, fin: number): boolean {
  const piste = sequence.tracks.find((t) => t.id === trackId);
  return piste !== undefined && piste.clips.every((c) => clipEnd(c) <= debut || c.start >= fin);
}

export interface BilanFilm {
  readonly ajoutes: number;
  readonly remplaces: number;
  /** Plans dont une nouvelle version existe, mais que le monteur a retirés du film. */
  readonly horsFilm: number;
}

export interface ResultatFilm {
  readonly sequence: SequenceDoc;
  readonly liens: LiensFilm;
  readonly bilan: BilanFilm;
}

/**
 * Amène le montage à jour des plans du studio.
 *
 * `medias` : tous les médias connus du document, nouveaux compris. `recus` : les nouveaux, avec leur
 * fichier d'origine. Un média attendu mais absent (téléchargement échoué) laisse le plan en attente :
 * la prochaine synchronisation réessaiera.
 */
export function synchroniserFilm(
  depart: SequenceDoc,
  plans: readonly PlanDuFilm[],
  liensDepart: LiensFilm,
  medias: readonly MediaAssetDoc[],
  recus: readonly MediaRecu[],
): ResultatFilm {
  const media: Record<string, LiensFilm['media'][string]> = { ...liensDepart.media };
  for (const r of recus) {
    media[r.asset.id] = { assetId: r.assetId, shotId: r.shotId, mimeType: r.mimeType };
  }
  const shots: Record<string, LiensFilm['shots'][string]> = { ...liensDepart.shots };
  let attentes: Record<string, string> = { ...liensDepart.attentes };
  const liens = (): LiensFilm => ({ media, shots, attentes });
  const parId = new Map(medias.map((m) => [m.id, m]));

  let sequence = depart;
  let ajoutes = 0;
  let remplaces = 0;
  let horsFilm = 0;
  const ctx = contexteFilm(depart, medias);
  const pisteImage = () => sequence.tracks.find((t) => t.kind === 'video' && t.index === 0);
  const pisteSon = () => sequence.tracks.find((t) => t.kind === 'audio' && t.index === 0);

  plans.forEach((plan, rang) => {
    const connu = shots[plan.shotId];
    const assetId = plan.media?.assetId ?? null;
    if (connu !== undefined && (assetId === null || connu.assetId === assetId)) return;

    const mediaId = assetId === null ? null : mediaDuPlan(liens(), plan.shotId, assetId);
    const asset = mediaId === null ? null : (parId.get(mediaId) ?? null);
    const nom = plan.name ? `${plan.label} — ${plan.name}` : plan.label;

    if (connu === undefined) {
      // Plan jamais vu : il entre à sa place, juste après le plan qui le précède dans le film.
      const image = pisteImage();
      if (image === undefined) return;
      let at = 0;
      for (let i = rang - 1; i >= 0; i -= 1) {
        const avant = plans[i];
        if (avant === undefined) continue;
        const clips = clipsImageDuPlan(sequence, avant.shotId, liens());
        const dernier = clips[clips.length - 1];
        if (dernier !== undefined) {
          at = clipEnd(dernier);
          break;
        }
      }
      const duree = dureePlan(plan, asset, sequence);
      const son = pisteSon();
      const groupe = asset !== null && aDuSon(asset) && son !== undefined ? newLinkGroupId() : null;
      const clip: ClipDoc =
        asset === null
          ? {
              ...createClip('colorMatte', image.id, at, duree, { name: nom }),
              label: COULEUR_ATTENTE,
            }
          : createClip('video', image.id, at, duree, {
              mediaId: asset.id,
              name: nom,
              linkGroup: groupe,
            });
      const pose = insert(sequence, { clip, trackId: image.id, at }, ctx);
      if (!pose.ok) return;
      sequence = pose.value;
      if (asset === null) attentes[clip.id] = plan.shotId;
      if (asset !== null && groupe !== null && son !== undefined) {
        const audio = createClip('audio', son.id, at, duree, {
          mediaId: asset.id,
          name: nom,
          linkGroup: groupe,
        });
        const posee = overwrite(sequence, { clip: audio, trackId: son.id, at }, ctx);
        if (posee.ok) sequence = posee.value;
      }
      shots[plan.shotId] = { assetId: asset === null ? null : assetId };
      ajoutes += 1;
      return;
    }

    // Plan connu dont le média a changé : ses clips gardent leur place et prennent le nouveau média.
    if (asset === null) return;
    const clips = clipsDuPlan(sequence, plan.shotId, liens());
    shots[plan.shotId] = { assetId };
    if (clips.length === 0) {
      horsFilm += 1;
      return;
    }
    const clipsImage = clips.filter((c) => c.kind !== 'audio');
    const clipsSon = clips.filter((c) => c.kind === 'audio');
    for (const clip of clipsImage) {
      let suivant = surNouveauMedia(clip, asset, nom, ctx);
      if (aDuSon(asset) && clipsSon.length === 0) {
        // La nouvelle version a du son : il rejoint A1 s'il n'écrase rien (une musique, par exemple).
        const son = pisteSon();
        if (son !== undefined && pisteLibre(sequence, son.id, suivant.start, clipEnd(suivant))) {
          const groupe = suivant.linkGroup ?? newLinkGroupId();
          suivant = { ...suivant, linkGroup: groupe };
          const audio = createClip('audio', son.id, suivant.start, suivant.duration, {
            mediaId: asset.id,
            name: nom,
            sourceIn: suivant.sourceIn,
            linkGroup: groupe,
          });
          const posee = overwrite(
            sequence,
            { clip: audio, trackId: son.id, at: suivant.start },
            ctx,
          );
          if (posee.ok) sequence = posee.value;
        }
      }
      sequence = remplacerClip(sequence, clip, suivant);
      attentes = Object.fromEntries(Object.entries(attentes).filter(([id]) => id !== clip.id));
    }
    for (const clip of clipsSon) {
      sequence = aDuSon(asset)
        ? remplacerClip(sequence, clip, surNouveauMedia(clip, asset, nom, ctx))
        : retirerClip(sequence, clip);
    }
    remplaces += 1;
  });

  return { sequence, liens: liens(), bilan: { ajoutes, remplaces, horsFilm } };
}

/** Oublie un plan : la prochaine synchronisation le remet dans le film, à sa place. */
export function oublierPlan(liens: LiensFilm, shotId: string): LiensFilm {
  return {
    ...liens,
    shots: Object.fromEntries(Object.entries(liens.shots).filter(([id]) => id !== shotId)),
  };
}
