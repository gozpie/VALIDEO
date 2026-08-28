/**
 * Presse-papiers de montage (sections 91, 93).
 *
 * Ce qui est copie n est PAS un morceau de timeline : c est un ensemble de
 * clips avec leurs positions RELATIVES, entre eux et par rapport aux pistes.
 * La difference est tout le sujet. Copier trois plans etages sur V1, V2 et A1
 * puis coller ailleurs doit reproduire l etagement, pas trois clips empiles au
 * meme endroit -- et le coller doit atterrir sur la piste CIBLEE du moment, pas
 * sur celle d ou vient la copie, qui n existe peut-etre plus.
 *
 * On memorise donc, pour chaque clip : son decalage temporel par rapport au
 * debut du groupe, et son decalage de piste par rapport a la piste la plus
 * basse de son type.
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok } from '@valideo/shared';
import { newClipId, newLinkGroupId } from '@valideo/shared';
import type { ClipDoc, SequenceDoc, TrackKind } from '@valideo/project-model';
import { clipEnd, findTrack } from './query.js';
import type { TimelineContext } from './source.js';
import type { EditResult } from './edit-ops.js';
import { insert, overwrite } from './edit-ops.js';

export interface ClipboardEntry {
  readonly clip: ClipDoc;
  readonly kind: TrackKind;
  /** Rang de piste relatif : 0 = la piste la plus basse de ce type dans la copie. */
  readonly trackOffset: number;
  /** Decalage temporel par rapport au clip le plus a gauche de la copie. */
  readonly offset: number;
}

export interface ClipboardContent {
  readonly entries: readonly ClipboardEntry[];
  /** Etendue totale de la copie, en images. Sert au collage par insertion. */
  readonly duration: number;
}

export function clipboardIsEmpty(contenu: ClipboardContent | null): boolean {
  return contenu === null || contenu.entries.length === 0;
}

/** Copie les clips designes. Ne modifie rien : la copie n est pas une operation. */
export function copyClips(
  sequence: SequenceDoc,
  clipIds: readonly string[],
): Result<ClipboardContent, AppError> {
  const trouves: { clip: ClipDoc; kind: TrackKind; index: number }[] = [];
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (clipIds.includes(clip.id)) {
        trouves.push({ clip, kind: track.kind, index: track.index });
      }
    }
  }
  if (trouves.length === 0) {
    return err(appError('CLIP_NOT_FOUND', 'Rien à copier.', { action: 'Sélectionnez un clip' }));
  }

  const debut = Math.min(...trouves.map((t) => t.clip.start));
  const fin = Math.max(...trouves.map((t) => clipEnd(t.clip)));
  // Les deux types de piste ont leur propre origine : copier V2 et A1 puis
  // coller doit poser sur la video ciblee et sur l audio ciblee, chacune a son
  // rang, et non decaler l audio de deux pistes parce que la video l etait.
  const baseVideo = Math.min(
    ...trouves.filter((t) => t.kind === 'video').map((t) => t.index),
    Number.POSITIVE_INFINITY,
  );
  const baseAudio = Math.min(
    ...trouves.filter((t) => t.kind === 'audio').map((t) => t.index),
    Number.POSITIVE_INFINITY,
  );

  return ok({
    duration: fin - debut,
    entries: trouves.map((t) => ({
      clip: t.clip,
      kind: t.kind,
      trackOffset: t.index - (t.kind === 'video' ? baseVideo : baseAudio),
      offset: t.clip.start - debut,
    })),
  });
}

export interface PasteOptions {
  /** Position du DEBUT de la copie sur la timeline. */
  readonly at: number;
  /** Piste video d atterrissage : celle de rang relatif 0. */
  readonly videoTrackId: string | null;
  readonly audioTrackId: string | null;
  /** Vrai pour un collage par insertion, qui decale la suite. */
  readonly insert?: boolean;
  readonly rippleTrackIds?: readonly string[];
}

/**
 * Colle le contenu du presse-papiers.
 *
 * Les identifiants sont TOUS renouveles -- clips et groupes de liaison. Coller
 * deux fois doit donner deux paires image/son independantes ; reutiliser les
 * identifiants d origine ferait bouger le collage precedent avec le nouveau.
 * La correspondance des groupes est conservee A L INTERIEUR du collage : une
 * image et son son colles ensemble restent lies entre eux.
 *
 * Le collage est ATOMIQUE. Chaque clip passe par `overwrite` ou `insert`, donc
 * par `finalize` ; si l un echoue, on renvoie l erreur et la sequence d origine
 * est intacte, jamais a moitie collee.
 */
export function pasteClips(
  sequence: SequenceDoc,
  contenu: ClipboardContent,
  options: PasteOptions,
  ctx: TimelineContext,
): EditResult {
  if (contenu.entries.length === 0) {
    return err(appError('EDIT_REJECTED', 'Le presse-papiers est vide.'));
  }
  if (options.at < 0) {
    return err(
      appError('EDIT_REJECTED', 'Un collage ne peut pas commencer avant le début de la séquence.'),
    );
  }

  const rangs = new Map<TrackKind, Map<number, string>>();
  for (const kind of ['video', 'audio'] as const) {
    const ancre = kind === 'video' ? options.videoTrackId : options.audioTrackId;
    if (ancre === null) continue;
    const piste = findTrack(sequence, ancre);
    if (piste === undefined || piste.kind !== kind) continue;
    const parRang = new Map<number, string>();
    for (const t of sequence.tracks) {
      if (t.kind === kind) parRang.set(t.index - piste.index, t.id);
    }
    rangs.set(kind, parRang);
  }

  const groupes = new Map<string, string>();
  let courante = sequence;

  // Pour une insertion, l ordre importe : on ouvre le trou une seule fois, sur
  // toute l etendue de la copie, avant de poser quoi que ce soit. Poser clip
  // par clip en insertion decalerait la copie par ses propres morceaux.
  if (options.insert === true) {
    const espace = makeSpacer(contenu.duration);
    const ancre = options.videoTrackId ?? options.audioTrackId ?? sequence.tracks[0]?.id ?? null;
    if (ancre === null) return err(appError('TRACK_NOT_FOUND', 'Aucune piste où coller.'));
    const ouvert = insert(
      courante,
      {
        clip: espace,
        trackId: ancre,
        at: options.at,
        ...(options.rippleTrackIds === undefined ? {} : { rippleTrackIds: options.rippleTrackIds }),
      },
      ctx,
    );
    if (!ouvert.ok) return ouvert;
    // Le clip d espacement a joue son role : il est retire aussitot, et les
    // clips colles viennent occuper le trou qu il a ouvert.
    courante = {
      ...ouvert.value,
      tracks: ouvert.value.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== espace.id),
      })),
    };
  }

  for (const entree of contenu.entries) {
    const cible = rangs.get(entree.kind)?.get(entree.trackOffset);
    if (cible === undefined) {
      return err(
        appError(
          'TRACK_NOT_FOUND',
          `Il manque une piste ${entree.kind === 'video' ? 'vidéo' : 'audio'} pour tout coller.`,
          { action: 'Ajoutez une piste, ou ciblez une piste plus basse' },
        ),
      );
    }
    let linkGroup: string | null = null;
    if (entree.clip.linkGroup !== null) {
      const connu = groupes.get(entree.clip.linkGroup);
      linkGroup = connu ?? newLinkGroupId();
      groupes.set(entree.clip.linkGroup, linkGroup);
    }
    const clip: ClipDoc = {
      ...entree.clip,
      id: newClipId(),
      trackId: cible,
      start: options.at + entree.offset,
      linkGroup,
    };
    const pose = overwrite(courante, { clip, trackId: cible, at: clip.start }, ctx);
    if (!pose.ok) return pose;
    courante = pose.value;
  }

  return ok(courante);
}

/**
 * Clip d espacement, jamais visible : il sert uniquement a faire ouvrir a
 * `insert` un trou de la bonne longueur, et il est retire dans la foulee.
 */
function makeSpacer(duration: number): ClipDoc {
  return {
    id: newClipId(),
    kind: 'colorMatte',
    mediaId: null,
    nestedSequenceId: null,
    trackId: '',
    name: '',
    start: 0,
    duration: Math.max(1, duration),
    sourceIn: 0,
    speed: { n: 1, d: 1 },
    reverse: false,
    frameSampling: 'nearest',
    enabled: true,
    linkGroup: null,
    effects: [],
    transform: {
      position: { value: [0, 0], keyframes: [] },
      scale: { value: [100, 100], keyframes: [] },
      rotation: { value: 0, keyframes: [] },
      anchorPoint: { value: [0, 0], keyframes: [] },
    },
    opacity: { value: 100, keyframes: [] },
    blendMode: 'normal',
    audio: {
      gainDb: { value: 0, keyframes: [] },
      pan: { value: 0, keyframes: [] },
      channelMap: [],
    },
    label: null,
    markers: [],
  };
}
