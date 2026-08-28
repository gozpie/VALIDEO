/**
 * Viewport de la timeline : correspondance temps <-> pixels, zoom, defilement
 * (sections 17 et 2).
 *
 * Le viewport est une valeur immuable, minuscule et sans dependance a l
 * interface. Consequence : deplacer la vue ou zoomer ne declenche AUCUN
 * recalcul de montage et aucun rendu React -- on recalcule une projection et on
 * redessine un canvas. C est la condition de la fluidite exigee par la
 * section 2.
 *
 * Ici, et seulement ici, les flottants sont legitimes : il s agit de pixels a
 * l ecran, pas de temps de montage. Toute frontiere vers le modele repasse par
 * des images entieres.
 */
import type { TimeBase } from '@valideo/time-core';
import { round as ratRound, rational, toNumber } from '@valideo/time-core';

export interface Viewport {
  /** Premiere image visible a gauche. Peut etre fractionnaire pendant un defilement. */
  readonly scroll: number;
  /** Echelle : largeur d une image en pixels. */
  readonly pixelsPerFrame: number;
  /** Largeur utile de la zone de timeline, en pixels CSS. */
  readonly width: number;
}

/**
 * Zoom maximal : une image occupe 64 px. La section 17 exige qu au zoom
 * maximal une image soit clairement identifiable.
 */
export const MAX_PIXELS_PER_FRAME = 64;

/** Zoom minimal : 20 heures a 25 images/s tiennent dans 1000 px. */
export const MIN_PIXELS_PER_FRAME = 1000 / (20 * 3600 * 25);

export function viewport(scroll: number, pixelsPerFrame: number, width: number): Viewport {
  return {
    scroll,
    pixelsPerFrame: clampScale(pixelsPerFrame),
    width: Math.max(1, width),
  };
}

export function clampScale(pixelsPerFrame: number): number {
  if (!Number.isFinite(pixelsPerFrame) || pixelsPerFrame <= 0) return MIN_PIXELS_PER_FRAME;
  return Math.min(MAX_PIXELS_PER_FRAME, Math.max(MIN_PIXELS_PER_FRAME, pixelsPerFrame));
}

/** Image -> abscisse en pixels, relative au bord gauche du viewport. */
export function timeToX(vp: Viewport, frame: number): number {
  return (frame - vp.scroll) * vp.pixelsPerFrame;
}

/** Abscisse -> image, non arrondie. */
export function xToTimeExact(vp: Viewport, x: number): number {
  return vp.scroll + x / vp.pixelsPerFrame;
}

/** Abscisse -> image entiere. C est la frontiere vers le modele : on tronque. */
export function xToTime(vp: Viewport, x: number): number {
  return Math.floor(xToTimeExact(vp, x));
}

/** Derniere image visible (exclue). */
export function visibleEnd(vp: Viewport): number {
  return vp.scroll + vp.width / vp.pixelsPerFrame;
}

export function visibleRange(vp: Viewport): { start: number; end: number } {
  return { start: Math.floor(vp.scroll), end: Math.ceil(visibleEnd(vp)) };
}

/**
 * Zoom en gardant fixe l image situee sous le pointeur (section 17).
 * `factor` > 1 rapproche.
 */
export function zoomAt(vp: Viewport, anchorX: number, factor: number): Viewport {
  const anchorFrame = xToTimeExact(vp, anchorX);
  const scale = clampScale(vp.pixelsPerFrame * factor);
  return { ...vp, pixelsPerFrame: scale, scroll: anchorFrame - anchorX / scale };
}

/** Zoom centre sur le milieu du viewport : c est le zoom au clavier. */
export function zoomCentered(vp: Viewport, factor: number): Viewport {
  return zoomAt(vp, vp.width / 2, factor);
}

/** Ajuste l echelle pour qu une duree tienne exactement dans la largeur. */
export function fit(vp: Viewport, duration: number, padding = 0): Viewport {
  const usable = Math.max(1, vp.width - padding * 2);
  const scale = clampScale(duration <= 0 ? MAX_PIXELS_PER_FRAME : usable / duration);
  return { ...vp, pixelsPerFrame: scale, scroll: -padding / scale };
}

/** Defile de `deltaPixels` pixels. */
export function scrollBy(vp: Viewport, deltaPixels: number): Viewport {
  return { ...vp, scroll: vp.scroll + deltaPixels / vp.pixelsPerFrame };
}

/** Amene une image dans la vue, avec une marge, sans bouger si elle y est deja. */
export function scrollIntoView(vp: Viewport, frame: number, marginPixels = 40): Viewport {
  const x = timeToX(vp, frame);
  if (x >= marginPixels && x <= vp.width - marginPixels) return vp;
  if (x < marginPixels) return { ...vp, scroll: frame - marginPixels / vp.pixelsPerFrame };
  return { ...vp, scroll: frame - (vp.width - marginPixels) / vp.pixelsPerFrame };
}

/** Empeche de defiler trop loin dans le vide au-dela de la fin du montage. */
export function clampScroll(vp: Viewport, duration: number, overscrollPixels = 200): Viewport {
  const maxScroll = Math.max(0, duration - (vp.width - overscrollPixels) / vp.pixelsPerFrame);
  return { ...vp, scroll: Math.min(Math.max(0, vp.scroll), Math.max(0, maxScroll)) };
}

// -------------------------------------------------- Niveaux de detail (§17, §18)

/**
 * Niveau de detail deduit de l echelle.
 *
 * Le principe de la section 55 : ce qui n est pas lisible ne doit pas etre
 * calcule. A 0,05 px par image, dessiner une forme d onde ou une vignette est
 * du travail pur perdu.
 */
export type DetailLevel = 'frame' | 'detailed' | 'normal' | 'compact' | 'overview';

export function detailLevel(vp: Viewport): DetailLevel {
  const p = vp.pixelsPerFrame;
  if (p >= 8) return 'frame';
  if (p >= 1) return 'detailed';
  if (p >= 0.2) return 'normal';
  if (p >= 0.02) return 'compact';
  return 'overview';
}

export interface DetailPolicy {
  readonly level: DetailLevel;
  /** Dessiner les vignettes du clip (section 18). */
  readonly thumbnails: boolean;
  /** Dessiner les formes d onde (section 19). */
  readonly waveforms: boolean;
  /** Afficher le nom du clip. */
  readonly labels: boolean;
  /** Dessiner les poignees de transition et de keyframes. */
  readonly handles: boolean;
  /** Dessiner la grille image par image. */
  readonly frameGrid: boolean;
}

export function detailPolicy(vp: Viewport): DetailPolicy {
  const level = detailLevel(vp);
  return {
    level,
    frameGrid: level === 'frame',
    thumbnails: level === 'frame' || level === 'detailed',
    waveforms: level !== 'overview' && level !== 'compact',
    labels: level !== 'overview',
    handles: level === 'frame' || level === 'detailed' || level === 'normal',
  };
}

// ----------------------------------------------------------- Graduations (§17)

/**
 * Echelle de graduations, en images, du plus fin au plus large.
 * Construite a partir de la cadence pour que les reperes tombent sur des
 * secondes et des minutes rondes, jamais sur des valeurs arbitraires.
 */
export function tickLadder(timebase: TimeBase): number[] {
  const fps = ratRound(timebase.rate);
  const seconds = (n: number): number => fps * n;
  return [
    1,
    2,
    5,
    10,
    Math.max(1, Math.floor(fps / 2)),
    seconds(1),
    seconds(2),
    seconds(5),
    seconds(10),
    seconds(15),
    seconds(30),
    seconds(60),
    seconds(120),
    seconds(300),
    seconds(600),
    seconds(1800),
    seconds(3600),
  ]
    .filter((v) => v >= 1)
    .sort((a, b) => a - b)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

/** Intervalle de graduation le plus fin qui respecte un espacement minimal. */
export function tickInterval(vp: Viewport, timebase: TimeBase, minSpacingPixels = 80): number {
  const ladder = tickLadder(timebase);
  for (const step of ladder) {
    if (step * vp.pixelsPerFrame >= minSpacingPixels) return step;
  }
  const last = ladder[ladder.length - 1] ?? 1;
  // Au-dela de l heure, on continue par multiples entiers d heures.
  const needed = Math.ceil(minSpacingPixels / (last * vp.pixelsPerFrame));
  return last * Math.max(1, needed);
}

/** Graduations visibles, alignees sur des multiples de l intervalle. */
export function ticks(vp: Viewport, timebase: TimeBase, minSpacingPixels = 80): number[] {
  const step = tickInterval(vp, timebase, minSpacingPixels);
  const { start, end } = visibleRange(vp);
  const first = Math.floor(start / step) * step;
  const out: number[] = [];
  for (let t = first; t <= end; t += step) {
    if (t >= 0) out.push(t);
  }
  return out;
}

/** Nombre de secondes couvertes par le viewport. Utile pour les tests et l affichage. */
export function visibleSeconds(vp: Viewport, timebase: TimeBase): number {
  return vp.width / vp.pixelsPerFrame / toNumber(timebase.rate);
}

/** Echelle correspondant a un nombre de secondes visibles donne. */
export function scaleForSeconds(width: number, seconds: number, timebase: TimeBase): number {
  const frames = toNumber(rational(1)) * seconds * toNumber(timebase.rate);
  return clampScale(width / Math.max(1, frames));
}
