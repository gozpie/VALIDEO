/**
 * Operations de montage professionnelles (sections 14, 91, 92, 93).
 *
 * Chaque operation suit la sequence imposee par la section 70 :
 *   1. determiner les clips affectes ;
 *   2. calculer le nouvel etat ;
 *   3. valider les contraintes ;
 *   4. appliquer atomiquement.
 *
 * Aucune ne mute quoi que ce soit, et toutes repassent par `finalize()` qui
 * re-verifie les invariants de piste. Une operation qui produirait un
 * chevauchement est REFUSEE, jamais appliquee a moitie.
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok } from '@valideo/shared';
import { newClipId, newLinkGroupId } from '@valideo/shared';
import { rational } from '@valideo/time-core';
import type { ClipDoc, SequenceDoc, TrackDoc } from '@valideo/project-model';
import { createTrack } from '@valideo/project-model';
import {
  clipEnd,
  clipsInRange,
  checkSequence,
  findClip,
  findTrack,
  nextEditPoint,
  previousEditPoint,
} from './query.js';
import type { TimelineContext } from './source.js';
import {
  handleAfter,
  handleBefore,
  shiftedSourceIn,
  sourceFramesUsed,
  sourceOut,
  toTimelineFrames,
} from './source.js';
import {
  clearRange,
  closeGap,
  mapTrack,
  openGap,
  placeClip,
  removeClip,
  splitAt,
  updateClip,
} from './track-ops.js';

export type EditResult = Result<SequenceDoc, AppError>;

// ------------------------------------------------------------------ garde-fous

function rejected(message: string, detail?: string): AppError {
  return detail === undefined
    ? appError('EDIT_REJECTED', message)
    : appError('EDIT_REJECTED', message, { detail });
}

function requireTrack(sequence: SequenceDoc, trackId: string): Result<TrackDoc, AppError> {
  const track = findTrack(sequence, trackId);
  if (track === undefined) {
    return err(appError('TRACK_NOT_FOUND', "Cette piste n'existe plus.", { detail: trackId }));
  }
  if (track.locked) {
    return err(
      appError('TRACK_LOCKED', `La piste ${track.name} est verrouillée.`, {
        action: 'Déverrouiller la piste',
      }),
    );
  }
  return ok(track);
}

function requireClip(
  sequence: SequenceDoc,
  clipId: string,
): Result<{ clip: ClipDoc; track: TrackDoc }, AppError> {
  const found = findClip(sequence, clipId);
  if (found === undefined) {
    return err(appError('CLIP_NOT_FOUND', "Ce clip n'existe plus.", { detail: clipId }));
  }
  if (found.track.locked) {
    return err(
      appError('TRACK_LOCKED', `La piste ${found.track.name} est verrouillée.`, {
        action: 'Déverrouiller la piste',
      }),
    );
  }
  return ok(found);
}

/**
 * Derniere barriere avant de rendre un etat : les invariants de piste sont
 * re-verifies. Un montage qui aurait produit un chevauchement est refuse.
 */
function finalize(sequence: SequenceDoc): EditResult {
  const violations = checkSequence(sequence);
  if (violations.length > 0) {
    const first = violations[0];
    return err(
      rejected(
        'Cette opération produirait un montage incohérent.',
        first === undefined
          ? undefined
          : `${first.kind} sur la piste ${first.trackId} : ${first.detail}`,
      ),
    );
  }
  return ok(sequence);
}

/** Pistes qui doivent suivre un ripple : verrouillees exclues (section 14). */
function rippleTargets(sequence: SequenceDoc, explicit: readonly string[] | undefined): string[] {
  if (explicit !== undefined) return [...explicit];
  return sequence.tracks.filter((t) => t.syncLock && !t.locked).map((t) => t.id);
}

/**
 * Pistes concernees par une operation de type Extract : les CIBLEES, plus
 * celles dont la synchronisation est active.
 *
 * C est le sens meme du verrou de synchronisation. Retirer une plage des seules
 * pistes ciblees tout en decalant les pistes synchronisees les desynchroniserait
 * -- exactement ce que ce verrou existe pour empecher. Pour laisser une piste en
 * dehors de l operation, on decoche sa synchronisation.
 *
 * Une seule definition, utilisee par l interface comme par le moteur : deux
 * copies de cette regle finiraient par diverger, et le montage avec elles.
 */
export function syncedTargets(sequence: SequenceDoc): string[] {
  const ids = new Set<string>();
  for (const t of sequence.tracks) {
    if (t.locked) continue;
    if (t.targeted || t.syncLock) ids.add(t.id);
  }
  return [...ids];
}

function tracksOf(sequence: SequenceDoc, ids: readonly string[]): TrackDoc[] {
  return sequence.tracks.filter((t) => ids.includes(t.id));
}

// ------------------------------------------------------------ Overwrite (§91)

export interface OverwriteOptions {
  readonly clip: ClipDoc;
  readonly trackId: string;
  readonly at: number;
}

/**
 * Overwrite : pose le clip et efface ce qu il recouvre.
 * Ne modifie PAS la duree de la sequence, sauf si le clip la depasse (section 91).
 */
export function overwrite(
  sequence: SequenceDoc,
  options: OverwriteOptions,
  ctx: TimelineContext,
): EditResult {
  const track = requireTrack(sequence, options.trackId);
  if (!track.ok) return track;
  if (options.clip.duration < 1) return err(rejected('Un clip doit durer au moins une image.'));
  if (options.at < 0)
    return err(rejected('Un clip ne peut pas commencer avant le début de la séquence.'));

  const placed: ClipDoc = { ...options.clip, start: options.at, trackId: options.trackId };
  const end = clipEnd(placed);

  return finalize({
    ...sequence,
    tracks: mapTrack(sequence.tracks, options.trackId, (t) =>
      placeClip(clearRange(t, placed.start, end, ctx), placed),
    ),
  });
}

// --------------------------------------------------------------- Insert (§91)

export interface InsertOptions {
  readonly clip: ClipDoc;
  readonly trackId: string;
  readonly at: number;
  /**
   * Pistes decalees par l insertion. Par defaut toutes les pistes en sync lock
   * et non verrouillees : c est le comportement attendu, l insertion ne doit
   * pas desynchroniser le reste du montage.
   */
  readonly rippleTrackIds?: readonly string[];
}

/** Insert : ouvre un trou sur les pistes synchronisees, puis pose le clip. */
export function insert(
  sequence: SequenceDoc,
  options: InsertOptions,
  ctx: TimelineContext,
): EditResult {
  const track = requireTrack(sequence, options.trackId);
  if (!track.ok) return track;
  if (options.clip.duration < 1) return err(rejected('Un clip doit durer au moins une image.'));
  if (options.at < 0)
    return err(rejected('Un clip ne peut pas commencer avant le début de la séquence.'));

  const amount = options.clip.duration;
  const shifted = new Set(rippleTargets(sequence, options.rippleTrackIds));
  shifted.add(options.trackId); // la piste cible est toujours decalee

  const opened = sequence.tracks.map((t) =>
    shifted.has(t.id) && !t.locked ? openGap(t, options.at, amount, ctx) : t,
  );

  const placed: ClipDoc = { ...options.clip, start: options.at, trackId: options.trackId };
  return finalize({
    ...sequence,
    tracks: mapTrack(opened, options.trackId, (t) => placeClip(t, placed)),
  });
}

// ----------------------------------------------------- Lift et Extract (§92)

export interface RangeOptions {
  readonly start: number;
  readonly end: number;
  /** Pistes sur lesquelles la plage est retiree. */
  readonly trackIds: readonly string[];
}

/** Lift : retire la plage et LAISSE le trou (section 92). */
export function lift(
  sequence: SequenceDoc,
  options: RangeOptions,
  ctx: TimelineContext,
): EditResult {
  if (options.end <= options.start) return err(rejected('La plage à retirer est vide.'));
  for (const id of options.trackIds) {
    const t = requireTrack(sequence, id);
    if (!t.ok) return t;
  }
  let tracks = sequence.tracks;
  for (const id of options.trackIds) {
    tracks = mapTrack(tracks, id, (t) => clearRange(t, options.start, options.end, ctx));
  }
  return finalize({ ...sequence, tracks });
}

export interface ExtractOptions extends RangeOptions {
  /** Pistes decalees pour refermer le trou. Par defaut : celles en sync lock. */
  readonly rippleTrackIds?: readonly string[];
}

/** Extract : retire la plage et REFERME le trou (section 92). */
export function extract(
  sequence: SequenceDoc,
  options: ExtractOptions,
  ctx: TimelineContext,
): EditResult {
  const lifted = lift(sequence, options, ctx);
  if (!lifted.ok) return lifted;

  const amount = options.end - options.start;
  const shifted = new Set(rippleTargets(sequence, options.rippleTrackIds));
  for (const id of options.trackIds) shifted.add(id);

  // Une piste synchronisee qui porte encore du materiel dans la plage ne peut
  // pas etre refermee sans creer un chevauchement : on refuse explicitement
  // plutot que de casser le montage.
  for (const track of tracksOf(lifted.value, [...shifted])) {
    if (track.locked) continue;
    if (clipsInRange(track, options.start, options.end).length > 0) {
      return err(
        rejected(
          `La piste ${track.name} contient encore du contenu dans la plage à supprimer.`,
          'Décochez sa synchronisation, ou incluez-la dans la suppression.',
        ),
      );
    }
  }

  const tracks = lifted.value.tracks.map((t) =>
    shifted.has(t.id) && !t.locked ? closeGap(t, options.start, amount) : t,
  );
  return finalize({ ...lifted.value, tracks });
}

/** Supprime un clip. `ripple` referme le trou (Suppr contre Maj+Suppr). */
export function deleteClip(
  sequence: SequenceDoc,
  clipId: string,
  ctx: TimelineContext,
  ripple = false,
): EditResult {
  const found = requireClip(sequence, clipId);
  if (!found.ok) return found;
  const { clip, track } = found.value;
  const range: RangeOptions = { start: clip.start, end: clipEnd(clip), trackIds: [track.id] };
  return ripple ? extract(sequence, range, ctx) : lift(sequence, range, ctx);
}

// ------------------------------------------------- Razor et Add Edit (§94)

/**
 * Ajoute un point de coupe a `at` sur les pistes indiquees.
 *
 * Deux comportements que la version naive n avait pas, et qui ne sont pas des
 * raffinements :
 *
 * 1. LA COUPE SUIT LES LIAISONS. Couper l image d un plan lie sans couper son
 *    son laisserait une moitie d image liee a un son entier : le moindre
 *    deplacement les desynchroniserait. C est le comportement de tous les NLE,
 *    et `suivreLiaisons: false` -- Alt dans l interface -- permet de ne couper
 *    qu une piste quand c est vraiment ce qu on veut.
 *
 * 2. LES MOITIES SE REGROUPENT DEUX A DEUX. `splitAt` recopie le groupe de
 *    liaison sur la moitie droite ; sans correction, les quatre morceaux d une
 *    paire image/son coupee formeraient UN SEUL groupe, et selectionner la
 *    premiere moitie selectionnerait aussi la seconde. Les moities droites
 *    recoivent donc un groupe neuf -- ou aucun, si elles se retrouvent seules,
 *    un groupe a un membre ne voulant rien dire.
 */
export function razor(
  sequence: SequenceDoc,
  at: number,
  trackIds: readonly string[],
  ctx: TimelineContext,
  options: { readonly suivreLiaisons?: boolean } = {},
): EditResult {
  for (const id of trackIds) {
    const t = requireTrack(sequence, id);
    if (!t.ok) return t;
  }

  const traverse = (clip: ClipDoc): boolean => clip.start < at && clipEnd(clip) > at;

  const pistes = new Set(trackIds);
  if (options.suivreLiaisons !== false) {
    const groupes = new Set<string>();
    for (const t of sequence.tracks) {
      if (!pistes.has(t.id)) continue;
      for (const c of t.clips) if (traverse(c) && c.linkGroup !== null) groupes.add(c.linkGroup);
    }
    for (const t of sequence.tracks) {
      if (t.locked) continue;
      if (t.clips.some((c) => c.linkGroup !== null && groupes.has(c.linkGroup) && traverse(c))) {
        pistes.add(t.id);
      }
    }
  }

  // Groupes reellement coupes, et nombre de moities droites attendues : c est
  // ce qui permet de distinguer une paire coupee en deux paires d une moitie
  // qui se retrouve orpheline.
  const coupes = new Map<string, number>();
  for (const t of sequence.tracks) {
    if (!pistes.has(t.id)) continue;
    for (const c of t.clips) {
      if (!traverse(c) || c.linkGroup === null) continue;
      coupes.set(c.linkGroup, (coupes.get(c.linkGroup) ?? 0) + 1);
    }
  }

  let tracks = sequence.tracks;
  for (const id of pistes) {
    tracks = mapTrack(tracks, id, (t) => splitAt(t, at, ctx));
  }

  if (coupes.size > 0) {
    const neufs = new Map<string, string | null>();
    for (const [groupe, nombre] of coupes) {
      neufs.set(groupe, nombre >= 2 ? newLinkGroupId() : null);
    }
    tracks = tracks.map((t) =>
      pistes.has(t.id)
        ? {
            ...t,
            clips: t.clips.map((c) =>
              c.start === at && c.linkGroup !== null && neufs.has(c.linkGroup)
                ? { ...c, linkGroup: neufs.get(c.linkGroup) ?? null }
                : c,
            ),
          }
        : t,
    );
  }

  return finalize({ ...sequence, tracks });
}

/** Add Edit sur toutes les pistes ciblees (section 94). */
export function addEditAtPlayhead(
  sequence: SequenceDoc,
  at: number,
  ctx: TimelineContext,
): EditResult {
  const targets = sequence.tracks.filter((t) => t.targeted && !t.locked).map((t) => t.id);
  if (targets.length === 0) {
    return err(
      rejected(
        'Aucune piste ciblée.',
        'Ciblez au moins une piste pour ajouter un point de montage.',
      ),
    );
  }
  return razor(sequence, at, targets, ctx);
}

// ------------------------------------------------------------ Deplacement

export interface MoveOptions {
  readonly clipId: string;
  readonly toStart: number;
  readonly toTrackId?: string;
}

/** Deplace un clip. Il recouvre ce qui se trouve a l arrivee (comportement overwrite). */
export function moveClip(
  sequence: SequenceDoc,
  options: MoveOptions,
  ctx: TimelineContext,
): EditResult {
  const found = requireClip(sequence, options.clipId);
  if (!found.ok) return found;
  const { clip, track } = found.value;
  const targetId = options.toTrackId ?? track.id;

  const target = requireTrack(sequence, targetId);
  if (!target.ok) return target;
  if (options.toStart < 0)
    return err(rejected('Un clip ne peut pas commencer avant le début de la séquence.'));
  if (target.value.kind !== track.kind) {
    return err(
      rejected(
        `Un clip ${track.kind === 'video' ? 'vidéo' : 'audio'} ne peut pas aller sur une piste ${
          target.value.kind === 'video' ? 'vidéo' : 'audio'
        }.`,
      ),
    );
  }

  const detached = {
    ...sequence,
    tracks: mapTrack(sequence.tracks, track.id, (t) => removeClip(t, clip.id)),
  };
  return overwrite(detached, { clip, trackId: targetId, at: options.toStart }, ctx);
}

export interface DeplacementClip {
  readonly clipId: string;
  readonly toStart: number;
  readonly toTrackId?: string;
}

/**
 * Deplace PLUSIEURS clips en une seule operation atomique.
 *
 * Pourquoi une operation dediee plutot qu une boucle sur `moveClip` : deplacer
 * deux clips voisins l un apres l autre les fait s ecraser mutuellement. Si A
 * occupe [0,100[ et B [100,200[ et qu on les decale tous deux de +50, deplacer
 * A d abord ecrase le debut de B, qui est ensuite deplace ampute.
 *
 * On DETACHE donc tous les clips concernes, puis on les repose. C est aussi ce
 * qui rend le deplacement d une paire audio/video correct (section 80).
 */
export function moveClips(sequence: SequenceDoc, deplacements: readonly DeplacementClip[], ctx: TimelineContext): EditResult {
  if (deplacements.length === 0) return ok(sequence);

  // 1. Determiner : tous les clips doivent exister et etre deplacables.
  const resolus: { clip: ClipDoc; source: TrackDoc; cible: TrackDoc; debut: number }[] = [];
  for (const d of deplacements) {
    const found = requireClip(sequence, d.clipId);
    if (!found.ok) return found;
    const cibleId = d.toTrackId ?? found.value.track.id;
    const cible = requireTrack(sequence, cibleId);
    if (!cible.ok) return cible;
    if (cible.value.kind !== found.value.track.kind) {
      return err(
        rejected(
          `Un clip ${found.value.track.kind === 'video' ? 'vidéo' : 'audio'} ne peut pas aller sur une piste ${
            cible.value.kind === 'video' ? 'vidéo' : 'audio'
          }.`,
        ),
      );
    }
    if (d.toStart < 0) return err(rejected('Un clip ne peut pas commencer avant le début de la séquence.'));
    resolus.push({ clip: found.value.clip, source: found.value.track, cible: cible.value, debut: d.toStart });
  }

  // 2. Detacher TOUS les clips avant d en reposer un seul.
  let tracks = sequence.tracks;
  for (const r of resolus) {
    tracks = mapTrack(tracks, r.source.id, (t) => removeClip(t, r.clip.id));
  }

  // 3. Reposer, chacun effacant ce qu il recouvre.
  for (const r of resolus) {
    const place: ClipDoc = { ...r.clip, start: r.debut, trackId: r.cible.id };
    tracks = mapTrack(tracks, r.cible.id, (t) =>
      placeClip(clearRange(t, place.start, clipEnd(place), ctx), place),
    );
  }

  return finalize({ ...sequence, tracks });
}

/**
 * Supprime PLUSIEURS clips en une seule operation.
 *
 * En mode ripple, l ordre compte : on retire de la fin vers le debut, sinon la
 * fermeture du premier trou decale les suivants et on supprime la mauvaise
 * plage.
 */
export function deleteClips(
  sequence: SequenceDoc,
  clipIds: readonly string[],
  ctx: TimelineContext,
  ripple = false,
): EditResult {
  if (clipIds.length === 0) return ok(sequence);

  const cibles: ClipDoc[] = [];
  for (const id of clipIds) {
    const found = requireClip(sequence, id);
    if (!found.ok) return found;
    cibles.push(found.value.clip);
  }
  cibles.sort((a, b) => b.start - a.start);

  let courante = sequence;
  for (const clip of cibles) {
    const resultat = deleteClip(courante, clip.id, ctx, ripple);
    if (!resultat.ok) return resultat;
    courante = resultat.value;
  }
  return ok(courante);
}

// ------------------------------------------------------------------- Trim

export type TrimEdge = 'in' | 'out';
export type TrimMode = 'normal' | 'ripple';

export interface TrimOptions {
  readonly clipId: string;
  readonly edge: TrimEdge;
  /** Deplacement du bord, en images. Positif = vers la droite. */
  readonly delta: number;
  readonly mode?: TrimMode;
  readonly rippleTrackIds?: readonly string[];
}

/**
 * Borne le deplacement demande a ce que la source rend possible.
 *
 * Comportement de NLE : on ne refuse pas un trim trop long, on s arrete a la
 * derniere image disponible. Le refus est reserve aux cas ou meme une image ne
 * peut plus etre conservee.
 */
function clampTrim(clip: ClipDoc, edge: TrimEdge, delta: number, ctx: TimelineContext): number {
  if (edge === 'in') {
    // Vers la droite : on raccourcit, limite = laisser une image.
    let d = Math.min(delta, clip.duration - 1);
    // Vers la gauche : on rallonge, limite = poignee disponible avant l entree.
    const before = handleBefore(clip, ctx);
    if (before !== null) d = Math.max(d, -before);
    return d;
  }
  // Bord sortant. Vers la gauche : on raccourcit.
  let d = Math.max(delta, -(clip.duration - 1));
  const after = handleAfter(clip, ctx);
  if (after !== null) d = Math.min(d, after);
  return d;
}

export function trimClip(
  sequence: SequenceDoc,
  options: TrimOptions,
  ctx: TimelineContext,
): EditResult {
  const found = requireClip(sequence, options.clipId);
  if (!found.ok) return found;
  const { clip, track } = found.value;
  const mode = options.mode ?? 'normal';

  const delta = clampTrim(clip, options.edge, options.delta, ctx);
  if (delta === 0) return ok(sequence);

  const trimmed: ClipDoc =
    options.edge === 'in'
      ? {
          ...clip,
          // En ripple, le clip ne se decale PAS a droite : il garde sa place et
          // c est la suite du montage qui remonte. En trim simple, il recule et
          // laisse un trou.
          start: mode === 'ripple' ? clip.start : clip.start + delta,
          duration: clip.duration - delta,
          sourceIn: shiftedSourceIn(clip, delta, ctx),
        }
      : { ...clip, duration: clip.duration + delta };

  if (trimmed.duration < 1) return err(rejected('Un clip doit durer au moins une image.'));
  if (trimmed.start < 0)
    return err(rejected('Un clip ne peut pas commencer avant le début de la séquence.'));

  if (mode === 'normal') {
    // Trim simple : le clip recouvre ce qu il rencontre en s allongeant, et
    // laisse un trou en se raccourcissant.
    const withoutOld = mapTrack(sequence.tracks, track.id, (t) => removeClip(t, clip.id));
    const tracks = mapTrack(withoutOld, track.id, (t) =>
      placeClip(clearRange(t, trimmed.start, clipEnd(trimmed), ctx), trimmed),
    );
    return finalize({ ...sequence, tracks });
  }

  // Ripple trim : tout ce qui commencait apres l ancienne fin du clip suit le
  // deplacement de cette fin -- sur la piste et sur les pistes synchronisees.
  const pivot = clipEnd(clip);
  const shiftAmount = clipEnd(trimmed) - pivot;
  const shifted = new Set(rippleTargets(sequence, options.rippleTrackIds));
  shifted.add(track.id);

  const tracks = sequence.tracks.map((t) => {
    if (t.locked) return t;
    if (t.id === track.id) {
      const updated = updateClip(t, clip.id, trimmed);
      return {
        ...updated,
        clips: updated.clips
          .map((c) =>
            c.id !== clip.id && c.start >= pivot ? { ...c, start: c.start + shiftAmount } : c,
          )
          .sort((a, b) => a.start - b.start),
      };
    }
    if (!shifted.has(t.id)) return t;
    return {
      ...t,
      clips: t.clips
        .map((c) => (c.start >= pivot ? { ...c, start: c.start + shiftAmount } : c))
        .sort((a, b) => a.start - b.start),
    };
  });

  return finalize({ ...sequence, tracks });
}

/** Q et W : ripple trim jusqu a la tete de lecture (section 93). */
export function rippleTrimToPlayhead(
  sequence: SequenceDoc,
  at: number,
  side: 'previous' | 'next',
  ctx: TimelineContext,
): EditResult {
  // Le point de montage est cherche sur les pistes CIBLEES seules : c est ce
  // que le monteur regarde. Le retrait, lui, s etend aux pistes synchronisees,
  // sans quoi elles se decaleraient sans etre raccourcies.
  const targets = sequence.tracks.filter((t) => t.targeted && !t.locked).map((t) => t.id);
  if (targets.length === 0) return err(rejected('Aucune piste ciblée.'));

  const edge =
    side === 'previous'
      ? previousEditPoint(sequence, at, targets)
      : nextEditPoint(sequence, at, targets);
  if (edge === null)
    return err(rejected('Aucun point de montage de ce côté de la tête de lecture.'));

  const start = side === 'previous' ? edge : at;
  const end = side === 'previous' ? at : edge;
  if (end <= start) return err(rejected('La plage à supprimer est vide.'));

  return extract(sequence, { start, end, trackIds: syncedTargets(sequence) }, ctx);
}

// -------------------------------------------------------------------- Roll

/**
 * Rolling trim : deplace la coupe entre deux clips adjacents, sans changer la
 * duree totale. Le clip sortant s allonge de ce que le clip entrant perd.
 */
export function rollEdit(
  sequence: SequenceDoc,
  trackId: string,
  at: number,
  delta: number,
  ctx: TimelineContext,
): EditResult {
  const track = requireTrack(sequence, trackId);
  if (!track.ok) return track;
  if (delta === 0) return ok(sequence);

  const outgoing = track.value.clips.find((c) => clipEnd(c) === at);
  const incoming = track.value.clips.find((c) => c.start === at);
  if (outgoing === undefined || incoming === undefined) {
    return err(rejected("Il n'y a pas de point de montage à cette position.", `Position ${at}`));
  }

  // Le deplacement est borne par les deux clips a la fois.
  let d = delta;
  d = Math.min(d, incoming.duration - 1);
  d = Math.max(d, -(outgoing.duration - 1));
  const afterOut = handleAfter(outgoing, ctx);
  if (afterOut !== null) d = Math.min(d, afterOut);
  const beforeIn = handleBefore(incoming, ctx);
  if (beforeIn !== null) d = Math.max(d, -beforeIn);
  if (d === 0) return ok(sequence);

  const tracks = mapTrack(sequence.tracks, trackId, (t) => {
    const a = updateClip(t, outgoing.id, { duration: outgoing.duration + d });
    return updateClip(a, incoming.id, {
      start: incoming.start + d,
      duration: incoming.duration - d,
      sourceIn: shiftedSourceIn(incoming, d, ctx),
    });
  });
  return finalize({ ...sequence, tracks });
}

// -------------------------------------------------------------------- Slip

/**
 * Slip : fait defiler la source SOUS le clip. Position et duree sur la
 * timeline ne bougent pas, le contenu change.
 */
export function slipClip(
  sequence: SequenceDoc,
  clipId: string,
  delta: number,
  ctx: TimelineContext,
): EditResult {
  const found = requireClip(sequence, clipId);
  if (!found.ok) return found;
  const { clip, track } = found.value;
  if (delta === 0) return ok(sequence);

  let d = delta;
  const before = handleBefore(clip, ctx);
  if (before !== null) d = Math.max(d, -before);
  const after = handleAfter(clip, ctx);
  if (after !== null) d = Math.min(d, after);
  if (d === 0) return ok(sequence);

  const tracks = mapTrack(sequence.tracks, track.id, (t) =>
    updateClip(t, clip.id, { sourceIn: shiftedSourceIn(clip, d, ctx) }),
  );
  return finalize({ ...sequence, tracks });
}

// ------------------------------------------------------------------- Slide

/**
 * Slide : deplace le clip sur la timeline en poussant ses voisins. Le contenu
 * du clip ne change pas ; ce sont les voisins qui sont trimes.
 */
export function slideClip(
  sequence: SequenceDoc,
  clipId: string,
  delta: number,
  ctx: TimelineContext,
): EditResult {
  const found = requireClip(sequence, clipId);
  if (!found.ok) return found;
  const { clip, track } = found.value;
  if (delta === 0) return ok(sequence);

  const previous = track.clips.find((c) => clipEnd(c) === clip.start);
  const next = track.clips.find((c) => c.start === clipEnd(clip));

  let d = delta;
  if (previous !== undefined) {
    d = Math.max(d, -(previous.duration - 1));
    const afterPrev = handleAfter(previous, ctx);
    if (afterPrev !== null) d = Math.min(d, afterPrev);
  }
  if (next !== undefined) {
    d = Math.min(d, next.duration - 1);
    const beforeNext = handleBefore(next, ctx);
    if (beforeNext !== null) d = Math.max(d, -beforeNext);
  }
  if (previous === undefined && d < 0) d = Math.max(d, -clip.start);
  if (d === 0) return ok(sequence);

  const tracks = mapTrack(sequence.tracks, track.id, (t) => {
    let updated = updateClip(t, clip.id, { start: clip.start + d });
    if (previous !== undefined) {
      updated = updateClip(updated, previous.id, { duration: previous.duration + d });
    }
    if (next !== undefined) {
      updated = updateClip(updated, next.id, {
        start: next.start + d,
        duration: next.duration - d,
        sourceIn: shiftedSourceIn(next, d, ctx),
      });
    }
    return updated;
  });
  return finalize({ ...sequence, tracks });
}

// -------------------------------------------------------------- Vitesse (§38)

/**
 * Rate stretch : change la duree en ajustant la vitesse, la portion de source
 * utilisee restant identique.
 */
export function rateStretch(
  sequence: SequenceDoc,
  clipId: string,
  newDuration: number,
  ctx: TimelineContext,
): EditResult {
  const found = requireClip(sequence, clipId);
  if (!found.ok) return found;
  const { clip, track } = found.value;
  if (newDuration < 1) return err(rejected('Un clip doit durer au moins une image.'));

  if (sourceFramesUsed(clip, ctx) <= 0) {
    return err(rejected("Ce clip n'utilise aucune image source."));
  }

  // La portion de source consommee doit rester identique :
  //   source = duree x vitesse  =>  nouvelleVitesse = vitesse x duree / nouvelleDuree
  const speed = rational(clip.speed.n * clip.duration, clip.speed.d * newDuration);

  const tracks = mapTrack(sequence.tracks, track.id, (t) =>
    updateClip(t, clip.id, { duration: newDuration, speed: { n: speed.n, d: speed.d } }),
  );
  const next = { ...sequence, tracks };
  // Le clip peut avoir grandi : on verifie qu il n ecrase pas son voisin.
  return finalize(next);
}

export interface SpeedOptions {
  readonly clipId: string;
  /** Nouvelle vitesse. 1/1 = 100 %. Doit etre strictement positive. */
  readonly speed: { readonly n: number; readonly d: number };
  readonly reverse?: boolean;
  readonly frameSampling?: ClipDoc['frameSampling'];
  /** Vrai pour decaler les clips suivants du changement de duree. */
  readonly ripple?: boolean;
}

/**
 * Change la vitesse d un clip (section 38).
 *
 * La difference avec `rateStretch` est le sens de la contrainte. Ici c est la
 * VITESSE qui est donnee et la duree qui s ajuste ; la, c est la duree qui est
 * donnee et la vitesse qui s ajuste. La portion de source consommee est
 * conservee dans les deux cas : ralentir un plan ne doit pas se mettre a piocher
 * des images que le monteur n avait pas choisies.
 *
 * Inverser la lecture deplace le point d entree. Notre modele consomme les
 * images en DESCENDANT depuis `sourceIn` quand `reverse` est vrai ; pour rejouer
 * exactement le meme materiau a l envers, l entree doit donc passer a l ancienne
 * sortie. Sans cet ajustement, inverser un plan montrerait tout autre chose.
 */
export function changeSpeed(
  sequence: SequenceDoc,
  options: SpeedOptions,
  ctx: TimelineContext,
): EditResult {
  const found = requireClip(sequence, options.clipId);
  if (!found.ok) return found;
  const { clip, track } = found.value;

  const speed = rational(options.speed.n, options.speed.d);
  if (speed.n <= 0) {
    return err(
      appError('EDIT_REJECTED', 'La vitesse doit être strictement positive.', {
        action: 'Pour un arrêt sur image, figez une image plutôt que de mettre la vitesse à zéro',
      }),
    );
  }

  const utilisees = sourceFramesUsed(clip, ctx);
  if (utilisees <= 0) return err(rejected("Ce clip n'utilise aucune image source."));

  const reverse = options.reverse ?? clip.reverse;
  // On calcule la nouvelle duree sur un clip PORTANT DEJA la nouvelle vitesse :
  // `toTimelineFrames` lit la vitesse dans le clip qu on lui passe.
  const projete: ClipDoc = { ...clip, speed: { n: speed.n, d: speed.d } };
  const duration = Math.max(1, toTimelineFrames(projete, utilisees, ctx));

  // Inversion : l entree passe a l ancienne sortie, et reciproquement.
  const sourceIn = reverse === clip.reverse ? clip.sourceIn : sourceOut(clip, ctx);

  const modifs: Partial<ClipDoc> = {
    speed: { n: speed.n, d: speed.d },
    duration,
    reverse,
    sourceIn,
    ...(options.frameSampling === undefined ? {} : { frameSampling: options.frameSampling }),
  };

  let tracks = mapTrack(sequence.tracks, track.id, (t) => updateClip(t, clip.id, modifs));

  if (options.ripple === true) {
    // Le decalage s applique aux clips qui COMMENCENT apres celui-ci, sur sa
    // piste seule : etendre le ripple aux pistes synchronisees decalerait un
    // son qui n a aucune raison de suivre un changement de vitesse video.
    const delta = duration - clip.duration;
    if (delta !== 0) {
      tracks = mapTrack(tracks, track.id, (t) => ({
        ...t,
        clips: t.clips.map((c) =>
          c.id !== clip.id && c.start >= clipEnd(clip) ? { ...c, start: c.start + delta } : c,
        ),
      }));
    }
  }

  return finalize({ ...sequence, tracks });
}

// ------------------------------------------------------ Gestion des pistes (§14)

/**
 * Ajoute une piste au rang `index`, en decalant celles du dessus.
 *
 * Le rang est celui du MODELE (V1 = 0), pas celui de l affichage. Les clips ne
 * bougent pas : ils portent l identifiant de leur piste, pas son rang. Seuls
 * les rangs et les noms par defaut sont renumerotes -- une piste renommee a la
 * main garde son nom, parce que ce nom est une decision de l utilisateur.
 */
export function addTrack(
  sequence: SequenceDoc,
  kind: TrackDoc['kind'],
  index?: number,
): EditResult {
  const memeType = sequence.tracks.filter((t) => t.kind === kind);
  const rang = Math.max(0, Math.min(index ?? memeType.length, memeType.length));

  const decalees = sequence.tracks.map((t) =>
    t.kind === kind && t.index >= rang ? { ...t, index: t.index + 1 } : t,
  );
  const nouvelle: TrackDoc = {
    ...createTrack(kind, rang),
    // `createTrack` cible d office le rang 0 ; ici la piste vient s inserer
    // dans une sequence qui a deja ses cibles, et voler le ciblage
    // deplacerait silencieusement la destination d Insert et d Overwrite.
    targeted: false,
  };
  return finalize(renommerParDefaut({ ...sequence, tracks: [...decalees, nouvelle] }, kind));
}

/**
 * Retire une piste ET tout ce qu elle porte.
 *
 * Refuse la derniere piste de son type : une sequence sans aucune piste video
 * ni aucune piste audio ne pourrait plus rien recevoir, et rien dans
 * l interface ne permettrait d en recreer une a cet endroit.
 */
export function removeTrack(sequence: SequenceDoc, trackId: string): EditResult {
  const track = findTrack(sequence, trackId);
  if (track === undefined) {
    return err(appError('TRACK_NOT_FOUND', "Cette piste n'existe plus.", { detail: trackId }));
  }
  if (track.locked) {
    return err(
      appError('TRACK_LOCKED', `La piste ${track.name} est verrouillée.`, {
        action: 'Déverrouillez-la avant de la supprimer',
      }),
    );
  }
  if (sequence.tracks.filter((t) => t.kind === track.kind).length <= 1) {
    return err(
      rejected(
        `Impossible de supprimer la dernière piste ${track.kind === 'video' ? 'vidéo' : 'audio'}.`,
      ),
    );
  }

  const restantes = sequence.tracks
    .filter((t) => t.id !== trackId)
    .map((t) => (t.kind === track.kind && t.index > track.index ? { ...t, index: t.index - 1 } : t));

  // Les clips lies a un clip supprime perdent leur groupe : un groupe reduit a
  // un seul membre n a plus de sens, et le laisser ferait selectionner un
  // fantome.
  const groupesTouches = new Set(
    track.clips.map((c) => c.linkGroup).filter((g): g is string => g !== null),
  );
  const nettoyees = restantes.map((t) => ({
    ...t,
    clips: t.clips.map((c) =>
      c.linkGroup !== null && groupesTouches.has(c.linkGroup) ? { ...c, linkGroup: null } : c,
    ),
  }));

  return finalize(renommerParDefaut({ ...sequence, tracks: nettoyees }, track.kind));
}

/**
 * Renumerote les noms PAR DEFAUT (« V1 », « A3 ») apres une insertion ou une
 * suppression. Un nom personnalise n est jamais touche : renommer une piste
 * « Voix off » puis en ajouter une en dessous ne doit pas la rebaptiser « A2 ».
 */
function renommerParDefaut(sequence: SequenceDoc, kind: TrackDoc['kind']): SequenceDoc {
  const prefixe = kind === 'video' ? 'V' : 'A';
  const parDefaut = /^[VA]\d+$/;
  return {
    ...sequence,
    tracks: sequence.tracks.map((t) =>
      t.kind === kind && parDefaut.test(t.name)
        ? { ...t, name: `${prefixe}${String(t.index + 1)}` }
        : t,
    ),
  };
}

/** Renomme une piste. Un nom vide revient au nom par defaut de son rang. */
export function renameTrack(sequence: SequenceDoc, trackId: string, name: string): EditResult {
  const track = findTrack(sequence, trackId);
  if (track === undefined) {
    return err(appError('TRACK_NOT_FOUND', "Cette piste n'existe plus.", { detail: trackId }));
  }
  const propre = name.trim();
  const final =
    propre === ''
      ? `${track.kind === 'video' ? 'V' : 'A'}${String(track.index + 1)}`
      : propre.slice(0, 64);
  return finalize({
    ...sequence,
    tracks: sequence.tracks.map((t) => (t.id === trackId ? { ...t, name: final } : t)),
  });
}

// ---------------------------------------------------- Proprietes de clip (§87)

/** Renomme un clip. Le nom vide est autorise : le rendu retombe sur le type. */
export function renameClip(sequence: SequenceDoc, clipId: string, name: string): EditResult {
  const found = requireClip(sequence, clipId);
  if (!found.ok) return found;
  const { clip, track } = found.value;
  return finalize({
    ...sequence,
    tracks: mapTrack(sequence.tracks, track.id, (t) =>
      updateClip(t, clip.id, { name: name.trim().slice(0, 128) }),
    ),
  });
}

/**
 * Etiquette de couleur d un clip, ou `null` pour l enlever (section 87).
 * Aucune validation de la couleur ici : le document accepte n importe quelle
 * chaine CSS, et l interface n en propose qu une palette fixe.
 */
export function setClipLabel(
  sequence: SequenceDoc,
  clipIds: readonly string[],
  label: string | null,
): EditResult {
  let tracks = sequence.tracks;
  for (const id of clipIds) {
    const found = findClip(sequence, id);
    if (found === undefined) {
      return err(appError('CLIP_NOT_FOUND', "Ce clip n'existe plus.", { detail: id }));
    }
    tracks = mapTrack(tracks, found.track.id, (t) => updateClip(t, id, { label }));
  }
  return finalize({ ...sequence, tracks });
}

/**
 * Active ou desactive des clips (section 71).
 *
 * Un clip desactive reste EN PLACE et garde sa duree : il cesse simplement
 * d etre rendu. C est ce qui distingue « desactiver » de « supprimer », et
 * c est pour cela que la timeline le dessine en gris plutot que de le retirer.
 */
export function setClipEnabled(
  sequence: SequenceDoc,
  clipIds: readonly string[],
  enabled: boolean,
): EditResult {
  let tracks = sequence.tracks;
  for (const id of clipIds) {
    const found = findClip(sequence, id);
    if (found === undefined) {
      return err(appError('CLIP_NOT_FOUND', "Ce clip n'existe plus.", { detail: id }));
    }
    tracks = mapTrack(tracks, found.track.id, (t) => updateClip(t, id, { enabled }));
  }
  return finalize({ ...sequence, tracks });
}

// ------------------------------------------------------- Remplacement (§91)

export interface ReplaceOptions {
  readonly clipId: string;
  /** Nouveau media. `null` pour un clip synthetique. */
  readonly mediaId: string | null;
  readonly name?: string;
  readonly kind?: ClipDoc['kind'];
  /** Point d entree dans la NOUVELLE source. Zero par defaut. */
  readonly sourceIn?: number;
}

/**
 * Remplace le materiau d un clip en gardant sa PLACE et sa DUREE.
 *
 * C est la difference avec un simple glisser-deposer : le clip ne bouge pas,
 * ne change pas de longueur, et conserve tout ce qui a ete travaille dessus --
 * effets, transformation, opacite, gain, etiquette. Seule la source change.
 * Refaire le calage d un plan de remplacement a la main serait long et
 * approximatif ; c est precisement ce que cette operation evite.
 *
 * La vitesse et l inversion sont REINITIALISEES : elles decrivaient un rapport
 * a l ancienne source. Les conserver donnerait une duree source demandee sans
 * rapport avec ce que le nouveau media contient.
 */
export function replaceClip(
  sequence: SequenceDoc,
  options: ReplaceOptions,
  ctx: TimelineContext,
): EditResult {
  const found = requireClip(sequence, options.clipId);
  if (!found.ok) return found;
  const { clip, track } = found.value;

  const remplacant: ClipDoc = {
    ...clip,
    mediaId: options.mediaId,
    sourceIn: options.sourceIn ?? 0,
    speed: { n: 1, d: 1 },
    reverse: false,
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.kind === undefined ? {} : { kind: options.kind }),
  };

  // La source doit pouvoir fournir toute la duree du clip : sinon le
  // remplacement laisserait une fin noire, sans que rien ne le dise.
  const info = ctx.resolveSource(remplacant);
  if (info !== null) {
    const requises = sourceFramesUsed(remplacant, ctx);
    const disponibles = info.first + info.count - remplacant.sourceIn;
    if (disponibles < requises) {
      return err(
        appError('EDIT_REJECTED', 'Ce média est trop court pour remplacer ce clip.', {
          action: 'Choisissez un média plus long, ou raccourcissez le clip d’abord',
          detail: `${String(requises)} images demandées, ${String(Math.max(0, disponibles))} disponibles.`,
        }),
      );
    }
  }

  return finalize({
    ...sequence,
    tracks: mapTrack(sequence.tracks, track.id, (t) => placeClip(removeClip(t, clip.id), remplacant)),
  });
}

// ------------------------------------------------------- Liaison A/V (§80)

/** Lie plusieurs clips : ils se selectionnent et se deplacent ensemble. */
export function linkClips(sequence: SequenceDoc, clipIds: readonly string[]): EditResult {
  if (clipIds.length < 2)
    return err(rejected('Il faut au moins deux clips pour créer une liaison.'));
  const group = newLinkGroupId();
  let tracks = sequence.tracks;
  for (const id of clipIds) {
    const found = findClip(sequence, id);
    if (found === undefined)
      return err(appError('CLIP_NOT_FOUND', "Ce clip n'existe plus.", { detail: id }));
    tracks = mapTrack(tracks, found.track.id, (t) => updateClip(t, id, { linkGroup: group }));
  }
  return finalize({ ...sequence, tracks });
}

export function unlinkClips(sequence: SequenceDoc, clipIds: readonly string[]): EditResult {
  let tracks = sequence.tracks;
  for (const id of clipIds) {
    const found = findClip(sequence, id);
    if (found === undefined)
      return err(appError('CLIP_NOT_FOUND', "Ce clip n'existe plus.", { detail: id }));
    tracks = mapTrack(tracks, found.track.id, (t) => updateClip(t, id, { linkGroup: null }));
  }
  return finalize({ ...sequence, tracks });
}

/** Duplique un clip en lui donnant un identifiant neuf. */
export function duplicateClip(clip: ClipDoc): ClipDoc {
  return { ...clip, id: newClipId(), linkGroup: null };
}

// ------------------------------------------------------- Proprietes de piste

/** Proprietes de piste modifiables depuis l en-tete (section 14). */
export interface TrackFlags {
  readonly locked?: boolean;
  readonly enabled?: boolean;
  readonly muted?: boolean;
  readonly solo?: boolean;
  readonly targeted?: boolean;
  readonly syncLock?: boolean;
  readonly height?: number;
}

/**
 * Modifie les drapeaux d une piste.
 *
 * Le verrouillage est le SEUL drapeau modifiable sur une piste verrouillee :
 * sans cette exception, on ne pourrait plus jamais la deverrouiller.
 */
export function setTrackFlags(
  sequence: SequenceDoc,
  trackId: string,
  flags: TrackFlags,
): EditResult {
  const track = findTrack(sequence, trackId);
  if (track === undefined) {
    return err(appError('TRACK_NOT_FOUND', "Cette piste n'existe plus.", { detail: trackId }));
  }
  const seulementVerrou = Object.keys(flags).length === 1 && flags.locked !== undefined;
  if (track.locked && !seulementVerrou) {
    return err(
      appError('TRACK_LOCKED', `La piste ${track.name} est verrouillée.`, {
        action: 'Déverrouiller la piste',
      }),
    );
  }
  if (flags.height !== undefined && flags.height < 16) {
    return err(rejected('Une piste ne peut pas être plus basse que 16 pixels.'));
  }
  return finalize({
    ...sequence,
    tracks: sequence.tracks.map((t) => (t.id === trackId ? { ...t, ...flags } : t)),
  });
}

/**
 * Selection de piste vers l avant : tous les clips de la piste qui commencent
 * a `from` ou apres. C est l outil A des NLE (section 14).
 */
export function selectTrackForward(
  sequence: SequenceDoc,
  trackId: string,
  from: number,
  toutesPistes = false,
): string[] {
  const pistes = toutesPistes ? sequence.tracks : sequence.tracks.filter((t) => t.id === trackId);
  return pistes.flatMap((t) => t.clips.filter((c) => clipEnd(c) > from).map((c) => c.id));
}

// ------------------------------------------------- Zone de travail (§78, §92)

export interface WorkArea {
  readonly in: number | null;
  readonly out: number | null;
}

/**
 * Pose, deplace ou efface les points d entree et de sortie de la sequence.
 *
 * Regle des NLE, et elle n est pas arbitraire : poser une entree APRES la
 * sortie existante n est pas une erreur a refuser, c est le geste de quelqu un
 * qui recommence son reperage plus loin. On efface donc la borne devenue
 * incoherente au lieu de rejeter le geste -- refuser obligerait l utilisateur a
 * effacer lui-meme la sortie avant de pouvoir poser son entree.
 *
 * Les positions negatives sont ramenees a zero : il n y a pas de temps avant le
 * debut de la sequence.
 */
export function setWorkArea(sequence: SequenceDoc, zone: WorkArea): EditResult {
  const entree = zone.in === null ? null : Math.max(0, Math.trunc(zone.in));
  const sortie = zone.out === null ? null : Math.max(0, Math.trunc(zone.out));

  let workAreaIn = entree;
  let workAreaOut = sortie;
  if (workAreaIn !== null && workAreaOut !== null && workAreaIn >= workAreaOut) {
    // La borne EFFACEE est celle qu on n a pas posee. `setWorkArea` recoit
    // toujours la zone complete, donc on compare a l etat precedent pour savoir
    // laquelle des deux bouge.
    if (entree !== sequence.workAreaIn) workAreaOut = null;
    else workAreaIn = null;
  }

  return ok({ ...sequence, workAreaIn, workAreaOut });
}

/**
 * Plage effective a retirer, deduite des points d entree et de sortie.
 *
 * Renvoie `null` s il n y a pas de plage exploitable. Une seule borne posee ne
 * suffit PAS : Lift sur une entree seule retirerait tout jusqu a la fin de la
 * sequence, ce que personne n attend d une frappe unique.
 */
export function workAreaRange(sequence: SequenceDoc): { start: number; end: number } | null {
  const { workAreaIn, workAreaOut } = sequence;
  if (workAreaIn === null || workAreaOut === null) return null;
  if (workAreaOut <= workAreaIn) return null;
  return { start: workAreaIn, end: workAreaOut };
}
