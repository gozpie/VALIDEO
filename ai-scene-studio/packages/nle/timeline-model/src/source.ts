/**
 * Correspondance timeline <-> source.
 *
 * Un clip vit dans DEUX referentiels : sa position et sa duree sont en images
 * de la SEQUENCE, son point d entree est en images de la SOURCE. Les deux
 * cadences peuvent differer (rush 50p sur timeline 25p) et la vitesse s ajoute
 * par-dessus. Toute la conversion passe par ici, en rationnel exact.
 *
 * ADR-006 : le point de sortie source n est jamais stocke, il se derive.
 */
import type { ClipDoc } from '@valideo/project-model';
import type { Rational, TimeBase } from '@valideo/time-core';
import { div, mul, rational, round } from '@valideo/time-core';

/** Ce que le moteur sait de la source d un clip. */
export interface SourceInfo {
  /** Premiere image disponible. Presque toujours 0. */
  readonly first: number;
  /** Nombre d images disponibles. */
  readonly count: number;
  /** Cadence de la source. */
  readonly rate: Rational;
}

/**
 * Resout la source d un clip. Retourne `null` quand elle est inconnue :
 * media hors ligne, ou clip synthetique (titre, cache couleur) qui n a pas de
 * source bornee.
 */
export type SourceResolver = (clip: ClipDoc) => SourceInfo | null;

/** Resolveur qui ne sait rien. Les bornes source ne sont alors pas contraintes. */
export const noSourceInfo: SourceResolver = () => null;

export interface TimelineContext {
  /** Timebase de la sequence. */
  readonly timebase: TimeBase;
  readonly resolveSource: SourceResolver;
}

function speedOf(clip: ClipDoc): Rational {
  return rational(clip.speed.n, clip.speed.d);
}

/**
 * Convertit une duree de timeline en nombre d images SOURCE consommees, en
 * tenant compte de la vitesse et de l ecart de cadence.
 */
export function toSourceFrames(
  clip: ClipDoc,
  timelineFrames: number,
  ctx: TimelineContext,
): number {
  const info = ctx.resolveSource(clip);
  const rateRatio = info === null ? rational(1) : div(info.rate, ctx.timebase.rate);
  return round(mul(rational(timelineFrames), mul(speedOf(clip), rateRatio)));
}

/** Conversion inverse : images source -> images de timeline. */
export function toTimelineFrames(
  clip: ClipDoc,
  sourceFrames: number,
  ctx: TimelineContext,
): number {
  const info = ctx.resolveSource(clip);
  const rateRatio = info === null ? rational(1) : div(info.rate, ctx.timebase.rate);
  const factor = mul(speedOf(clip), rateRatio);
  if (factor.n === 0) return 0;
  return round(div(rational(sourceFrames), factor));
}

/** Nombre d images source consommees par le clip entier. */
export function sourceFramesUsed(clip: ClipDoc, ctx: TimelineContext): number {
  return toSourceFrames(clip, clip.duration, ctx);
}

/**
 * Point de sortie source, EXCLU. Derive, jamais stocke (ADR-006).
 * En lecture inversee, le clip consomme les images en descendant depuis
 * `sourceIn`, la sortie est donc en dessous de l entree.
 */
export function sourceOut(clip: ClipDoc, ctx: TimelineContext): number {
  const used = sourceFramesUsed(clip, ctx);
  return clip.reverse ? clip.sourceIn - used : clip.sourceIn + used;
}

/** Marge disponible AVANT le point d entree : de combien on peut rallonger a gauche. */
export function handleBefore(clip: ClipDoc, ctx: TimelineContext): number | null {
  const info = ctx.resolveSource(clip);
  if (info === null) return null;
  const sourceHandle = clip.reverse
    ? info.first + info.count - clip.sourceIn
    : clip.sourceIn - info.first;
  return Math.max(0, toTimelineFrames(clip, sourceHandle, ctx));
}

/** Marge disponible APRES le point de sortie : de combien on peut rallonger a droite. */
export function handleAfter(clip: ClipDoc, ctx: TimelineContext): number | null {
  const info = ctx.resolveSource(clip);
  if (info === null) return null;
  const out = sourceOut(clip, ctx);
  const sourceHandle = clip.reverse ? out - info.first : info.first + info.count - out;
  return Math.max(0, toTimelineFrames(clip, sourceHandle, ctx));
}

/**
 * Decale le point d entree source de `timelineDelta` images de timeline.
 * Un delta positif avance dans la source.
 */
export function shiftedSourceIn(
  clip: ClipDoc,
  timelineDelta: number,
  ctx: TimelineContext,
): number {
  const delta = toSourceFrames(clip, timelineDelta, ctx);
  return clip.reverse ? clip.sourceIn - delta : clip.sourceIn + delta;
}
