/**
 * Opérations de composition : réglages de clip, transitions, titres, volumes. Toutes passent par
 * `finalize` et par l'historique, comme le reste du montage.
 */
import type { Command } from '@valideo/command-system';
import { command } from '@valideo/command-system';
import { appError, err } from '@valideo/shared';
import type { ClipDoc, SequenceDoc, TitleDoc } from '@valideo/project-model';
import { createClip, newId } from '@valideo/project-model';
import type { EditResult } from './edit-ops';
import { addTrack, finalize } from './edit-ops';
import { clipEnd, findClip, findTrack } from './query';
import { placeClip, updateClip } from './track-ops';

export function modifierClips(
  sequence: SequenceDoc,
  clipIds: readonly string[],
  changer: (clip: ClipDoc) => ClipDoc,
): EditResult {
  let tracks = sequence.tracks;
  for (const id of clipIds) {
    const trouve = findClip(sequence, id);
    if (trouve === undefined) {
      return err(appError('CLIP_NOT_FOUND', "Ce clip n'existe plus.", { detail: id }));
    }
    if (trouve.track.locked) {
      return err(
        appError('TRACK_LOCKED', `La piste ${trouve.track.name} est verrouillée.`, {
          action: 'Déverrouiller la piste',
        }),
      );
    }
    tracks = tracks.map((t) =>
      t.id === trouve.track.id ? updateClip(t, id, changer(trouve.clip)) : t,
    );
  }
  return finalize({ ...sequence, tracks });
}

/** Réglage de clip. Une `mergeKey` fait d'un curseur tiré une seule annulation. */
export function modifierClipsCommand(
  clipIds: readonly string[],
  changer: (clip: ClipDoc) => ClipDoc,
  label: string,
  mergeKey: string | null = null,
): Command<SequenceDoc> {
  return command({ label, mergeKey, apply: (seq) => modifierClips(seq, clipIds, changer) });
}

export interface PoseTransition {
  readonly trackId: string;
  readonly fromClipId: string | null;
  readonly toClipId: string | null;
  readonly type: string;
  readonly duration: number;
}

/** Pose une transition : elle remplace celle qui occupait déjà cette tête ou cette queue de clip. */
export function poserTransition(sequence: SequenceDoc, pose: PoseTransition): EditResult {
  const piste = findTrack(sequence, pose.trackId);
  if (piste === undefined) {
    return err(appError('TRACK_NOT_FOUND', "Cette piste n'existe plus."));
  }
  if (piste.locked) {
    return err(
      appError('TRACK_LOCKED', `La piste ${piste.name} est verrouillée.`, {
        action: 'Déverrouiller la piste',
      }),
    );
  }
  const garde = piste.transitions.filter(
    (t) =>
      (pose.fromClipId === null || t.fromClipId !== pose.fromClipId) &&
      (pose.toClipId === null || t.toClipId !== pose.toClipId),
  );
  return finalize({
    ...sequence,
    tracks: sequence.tracks.map((t) =>
      t.id === piste.id
        ? {
            ...t,
            transitions: [
              ...garde,
              {
                id: newId(),
                type: pose.type,
                trackId: piste.id,
                start: 0,
                duration: Math.max(1, Math.round(pose.duration)),
                fromClipId: pose.fromClipId,
                toClipId: pose.toClipId,
                alignment: 'centered' as const,
                parameters: {},
              },
            ],
          }
        : t,
    ),
  });
}

export function poserTransitionCommand(pose: PoseTransition): Command<SequenceDoc> {
  return command({ label: 'Poser une transition', apply: (seq) => poserTransition(seq, pose) });
}

export function modifierTransitionCommand(
  id: string,
  modifs: { readonly type?: string; readonly duration?: number },
  mergeKey: string | null = null,
): Command<SequenceDoc> {
  return command({
    label: 'Modifier la transition',
    mergeKey,
    apply: (seq) =>
      finalize({
        ...seq,
        tracks: seq.tracks.map((piste) => ({
          ...piste,
          transitions: piste.transitions.map((t) =>
            t.id === id && !piste.locked
              ? {
                  ...t,
                  ...(modifs.type === undefined ? {} : { type: modifs.type }),
                  ...(modifs.duration === undefined
                    ? {}
                    : { duration: Math.max(1, Math.round(modifs.duration)) }),
                }
              : t,
          ),
        })),
      }),
  });
}

export function retirerTransitionCommand(id: string): Command<SequenceDoc> {
  return command({
    label: 'Retirer la transition',
    apply: (seq) =>
      finalize({
        ...seq,
        tracks: seq.tracks.map((piste) => ({
          ...piste,
          transitions: piste.locked
            ? piste.transitions
            : piste.transitions.filter((t) => t.id !== id),
        })),
      }),
  });
}

/** Libre sur [debut, fin[ et sans verrou. */
function pisteLibre(sequence: SequenceDoc, trackId: string, debut: number, fin: number): boolean {
  const piste = findTrack(sequence, trackId);
  return (
    piste !== undefined &&
    !piste.locked &&
    piste.clips.every((c) => clipEnd(c) <= debut || c.start >= fin)
  );
}

export interface PoseTitre {
  readonly titre: TitleDoc;
  readonly at: number;
  readonly duration: number;
  /** Piste voulue ; sinon la première piste libre au-dessus de V1, créée s'il le faut. */
  readonly trackId?: string;
  readonly clipId?: string;
}

export function poserTitre(sequence: SequenceDoc, pose: PoseTitre): EditResult {
  const fin = pose.at + pose.duration;
  let doc = sequence;
  let trackId = pose.trackId;
  if (trackId !== undefined) {
    if (!pisteLibre(doc, trackId, pose.at, fin)) {
      return err(
        appError('EDIT_REJECTED', 'Cette place est déjà prise sur cette piste.', {
          action: 'Déposez le titre sur une piste libre',
        }),
      );
    }
  } else {
    const libres = doc.tracks
      .filter((t) => t.kind === 'video' && t.index > 0)
      .sort((a, b) => a.index - b.index)
      .find((t) => pisteLibre(doc, t.id, pose.at, fin));
    if (libres === undefined) {
      const ajout = addTrack(doc, 'video');
      if (!ajout.ok) return ajout;
      const avant = new Set(doc.tracks.map((t) => t.id));
      doc = ajout.value;
      trackId = doc.tracks.find((t) => !avant.has(t.id))?.id;
    } else {
      trackId = libres.id;
    }
  }
  const accueil = trackId === undefined ? undefined : findTrack(doc, trackId);
  if (accueil === undefined) return err(appError('TRACK_NOT_FOUND', "Cette piste n'existe plus."));
  const clip: ClipDoc = {
    ...createClip('title', accueil.id, pose.at, pose.duration, {
      name: pose.titre.text.split('\n')[0] ?? 'Titre',
    }),
    title: pose.titre,
    ...(pose.clipId === undefined ? {} : { id: pose.clipId }),
  };
  return finalize({
    ...doc,
    tracks: doc.tracks.map((t) => (t.id === accueil.id ? placeClip(t, clip) : t)),
  });
}

export function poserTitreCommand(pose: PoseTitre): Command<SequenceDoc> {
  return command({ label: 'Ajouter un titre', apply: (seq) => poserTitre(seq, pose) });
}

export function volumeGeneralCommand(gainDb: number): Command<SequenceDoc> {
  return command({
    label: 'Volume général',
    mergeKey: 'volume-general',
    apply: (seq) => finalize({ ...seq, masterGainDb: gainDb }),
  });
}
