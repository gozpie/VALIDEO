/**
 * Transitions d'une piste.
 *
 * Deux clips qui se touchent : la transition est centrée sur le raccord, et chacun déborde de son côté
 * sur son propre média (image figée si le média s'arrête avant). Un seul clip : fondu d'entrée ou de
 * sortie, à l'intérieur du clip. La position se déduit toujours des clips : la bouger à la main n'a
 * aucun sens, et un montage qui les sépare fait disparaître la transition.
 */
import type { ClipDoc, SequenceDoc, TrackDoc, TransitionDoc } from '@valideo/project-model';

export const TRANSITIONS_IMAGE = [
  { id: 'dissolve', nom: 'Fondu enchaîné' },
  { id: 'dipBlack', nom: 'Fondu au noir' },
  { id: 'dipWhite', nom: 'Fondu au blanc' },
  { id: 'wipe', nom: 'Volet' },
  { id: 'push', nom: 'Poussée' },
] as const;

export const TRANSITION_SON = 'crossfade';

export function nomTransition(type: string): string {
  if (type === TRANSITION_SON) return 'Fondu sonore';
  return TRANSITIONS_IMAGE.find((t) => t.id === type)?.nom ?? 'Fondu enchaîné';
}

export interface TransitionEffective {
  readonly id: string;
  readonly type: string;
  readonly trackId: string;
  /** Première image touchée. */
  readonly debut: number;
  /** Première image qui n'est plus touchée. */
  readonly fin: number;
  readonly de: ClipDoc | null;
  readonly vers: ClipDoc | null;
  /** Durée demandée, avant ce que les clips permettent. */
  readonly dureeDemandee: number;
}

function bornes(
  duree: number,
  de: ClipDoc | null,
  vers: ClipDoc | null,
): { debut: number; fin: number } | null {
  if (de !== null && vers !== null) {
    if (de.start + de.duration !== vers.start) return null;
    const moitie = Math.floor(duree / 2);
    return {
      debut: vers.start - Math.min(moitie, de.duration),
      fin: vers.start + Math.min(duree - moitie, vers.duration),
    };
  }
  if (de !== null) {
    const fin = de.start + de.duration;
    return { debut: fin - Math.min(duree, de.duration), fin };
  }
  if (vers !== null) {
    return { debut: vers.start, fin: vers.start + Math.min(duree, vers.duration) };
  }
  return null;
}

const memoire = new WeakMap<TrackDoc, readonly TransitionEffective[]>();

/** Transitions réellement jouées sur la piste, dans l'ordre du temps. */
export function transitionsEffectives(piste: TrackDoc): readonly TransitionEffective[] {
  if (piste.transitions.length === 0) return [];
  const connue = memoire.get(piste);
  if (connue !== undefined) return connue;
  const clips = new Map(piste.clips.map((c) => [c.id, c]));
  const effectives: TransitionEffective[] = [];
  for (const t of piste.transitions) {
    const de = t.fromClipId === null ? null : (clips.get(t.fromClipId) ?? null);
    const vers = t.toClipId === null ? null : (clips.get(t.toClipId) ?? null);
    if ((t.fromClipId !== null && de === null) || (t.toClipId !== null && vers === null)) continue;
    const b = bornes(t.duration, de, vers);
    if (b === null) continue;
    effectives.push({
      id: t.id,
      type: t.type,
      trackId: piste.id,
      debut: b.debut,
      fin: b.fin,
      de,
      vers,
      dureeDemandee: t.duration,
    });
  }
  effectives.sort((a, b) => a.debut - b.debut);
  memoire.set(piste, effectives);
  return effectives;
}

/**
 * Remet les transitions d'accord avec les clips, après n'importe quelle opération : un fondu suit son
 * clip sur une autre piste ; une transition dont un clip a disparu, ou dont les clips ne se touchent
 * plus, disparaît. Sans transition, la séquence est rendue telle quelle.
 */
export function reconcilierTransitions(sequence: SequenceDoc): SequenceDoc {
  if (sequence.tracks.every((t) => t.transitions.length === 0)) return sequence;
  const parClip = new Map<string, { clip: ClipDoc; trackId: string }>();
  for (const piste of sequence.tracks) {
    for (const clip of piste.clips) parClip.set(clip.id, { clip, trackId: piste.id });
  }
  const parPiste = new Map<string, TransitionDoc[]>(sequence.tracks.map((t) => [t.id, []]));
  for (const piste of sequence.tracks) {
    for (const t of piste.transitions) {
      const de = t.fromClipId === null ? undefined : parClip.get(t.fromClipId);
      const vers = t.toClipId === null ? undefined : parClip.get(t.toClipId);
      if (
        (t.fromClipId !== null && de === undefined) ||
        (t.toClipId !== null && vers === undefined)
      )
        continue;
      if (de !== undefined && vers !== undefined && de.trackId !== vers.trackId) continue;
      const b = bornes(t.duration, de?.clip ?? null, vers?.clip ?? null);
      if (b === null) continue;
      const accueil = (de ?? vers)?.trackId;
      if (accueil === undefined) continue;
      parPiste.get(accueil)?.push({ ...t, trackId: accueil, start: b.debut });
    }
  }
  return {
    ...sequence,
    tracks: sequence.tracks.map((t) => ({ ...t, transitions: parPiste.get(t.id) ?? [] })),
  };
}

export interface Raccord {
  readonly image: number;
  readonly de: ClipDoc | null;
  readonly vers: ClipDoc | null;
}

/** Limite de clip la plus proche de cette image : un raccord, ou le bord d'un clip isolé. */
export function raccordProche(piste: TrackDoc, image: number): Raccord | null {
  let meilleur: Raccord | null = null;
  let ecart = Infinity;
  const proposer = (r: Raccord): void => {
    const e = Math.abs(r.image - image);
    if (e < ecart) {
      ecart = e;
      meilleur = r;
    }
  };
  const clips = piste.clips;
  clips.forEach((clip, i) => {
    const avant = clips[i - 1];
    const apres = clips[i + 1];
    const fin = clip.start + clip.duration;
    if (avant === undefined || avant.start + avant.duration !== clip.start) {
      proposer({ image: clip.start, de: null, vers: clip });
    }
    proposer({
      image: fin,
      de: clip,
      vers: apres !== undefined && apres.start === fin ? apres : null,
    });
  });
  return meilleur;
}
