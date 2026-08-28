/**
 * Accrochage magnetique (section 14).
 *
 * Regle : le seuil d accrochage est exprime en PIXELS, pas en images. C est ce
 * qui rend l accrochage utilisable a tous les niveaux de zoom -- a 0,05 px par
 * image, un seuil de 5 images serait invisible ; a 40 px par image, il
 * collerait de force sur un quart d ecran.
 */
import type { SequenceDoc } from '@valideo/project-model';
import { clipEnd, clipsInRange } from '@valideo/timeline-model';
import type { Viewport } from './viewport.js';
import { visibleRange } from './viewport.js';

export type SnapKind =
  'playhead' | 'clipStart' | 'clipEnd' | 'marker' | 'sequenceStart' | 'workArea';

export interface SnapTarget {
  readonly frame: number;
  readonly kind: SnapKind;
  readonly trackId: string | null;
}

export interface SnapOptions {
  readonly playhead?: number | null;
  /** Clips en cours de deplacement : ils ne doivent pas s accrocher a eux-memes. */
  readonly exclude?: ReadonlySet<string>;
  /** Restreindre aux pistes indiquees. */
  readonly trackIds?: readonly string[];
  readonly includeMarkers?: boolean;
}

/** Points d accrochage situes dans la vue. Hors champ, ils ne servent a rien. */
export function collectSnapTargets(
  sequence: SequenceDoc,
  vp: Viewport,
  options: SnapOptions = {},
): SnapTarget[] {
  const { start, end } = visibleRange(vp);
  const exclude = options.exclude ?? new Set<string>();
  const out: SnapTarget[] = [];

  const inView = (frame: number): boolean => frame >= start && frame <= end;

  if (inView(0)) out.push({ frame: 0, kind: 'sequenceStart', trackId: null });
  if (options.playhead !== null && options.playhead !== undefined && inView(options.playhead)) {
    out.push({ frame: options.playhead, kind: 'playhead', trackId: null });
  }
  if (sequence.workAreaIn !== null && inView(sequence.workAreaIn)) {
    out.push({ frame: sequence.workAreaIn, kind: 'workArea', trackId: null });
  }
  if (sequence.workAreaOut !== null && inView(sequence.workAreaOut)) {
    out.push({ frame: sequence.workAreaOut, kind: 'workArea', trackId: null });
  }

  for (const track of sequence.tracks) {
    if (options.trackIds !== undefined && !options.trackIds.includes(track.id)) continue;
    // Dichotomie plutot que parcours complet : sur 10 000 clips, la difference
    // est celle entre un accrochage instantane et un accrochage qui rame.
    for (const clip of clipsInRange(track, start, end + 1)) {
      if (exclude.has(clip.id)) continue;
      if (inView(clip.start)) out.push({ frame: clip.start, kind: 'clipStart', trackId: track.id });
      if (inView(clipEnd(clip)))
        out.push({ frame: clipEnd(clip), kind: 'clipEnd', trackId: track.id });
    }
  }

  if (options.includeMarkers !== false) {
    for (const marker of sequence.markers) {
      if (inView(marker.time)) out.push({ frame: marker.time, kind: 'marker', trackId: null });
    }
  }

  return out;
}

export interface SnapResult {
  readonly frame: number;
  readonly target: SnapTarget | null;
  /** Ecart applique, en images. 0 si aucun accrochage. */
  readonly delta: number;
}

/**
 * Accroche une position au point le plus proche, si un point tombe dans le
 * seuil. Retourne aussi la cible retenue, pour que l interface puisse afficher
 * le repere d accrochage (section 77).
 */
export function snapFrame(
  frame: number,
  targets: readonly SnapTarget[],
  vp: Viewport,
  thresholdPixels = 8,
  enabled = true,
): SnapResult {
  if (!enabled || targets.length === 0) return { frame, target: null, delta: 0 };

  const thresholdFrames = thresholdPixels / vp.pixelsPerFrame;
  let best: SnapTarget | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    const distance = Math.abs(target.frame - frame);
    if (distance <= thresholdFrames && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }

  if (best === null) return { frame, target: null, delta: 0 };
  return { frame: best.frame, target: best, delta: best.frame - frame };
}

/**
 * Accroche un clip qu on deplace : on essaie d accrocher son debut ET sa fin,
 * et on retient l accrochage le plus proche. Sans cela, seul le bord gauche
 * colle, ce qui est frustrant quand on aligne une fin de plan sur une coupe.
 */
export function snapClipMove(
  proposedStart: number,
  duration: number,
  targets: readonly SnapTarget[],
  vp: Viewport,
  thresholdPixels = 8,
  enabled = true,
): SnapResult {
  const head = snapFrame(proposedStart, targets, vp, thresholdPixels, enabled);
  const tail = snapFrame(proposedStart + duration, targets, vp, thresholdPixels, enabled);

  if (head.target === null && tail.target === null) {
    return { frame: proposedStart, target: null, delta: 0 };
  }
  if (tail.target === null) return head;
  if (head.target === null) {
    return { frame: tail.frame - duration, target: tail.target, delta: tail.delta };
  }
  return Math.abs(head.delta) <= Math.abs(tail.delta)
    ? head
    : { frame: tail.frame - duration, target: tail.target, delta: tail.delta };
}
