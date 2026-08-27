/**
 * Modele de rendu de la timeline (sections 2, 17, 55, 77).
 *
 * Transforme une sequence et un viewport en une LISTE PLATE d elements a
 * dessiner. Rien de plus.
 *
 * Deux proprietes rendent la timeline tenable a 10 000 clips :
 *   1. VIRTUALISATION -- seuls les clips qui intersectent la vue sont produits.
 *      Un clip hors champ ne coute qu une comparaison, pas un objet.
 *   2. BORNAGE -- les coordonnees sont bornees au viewport. Dessiner un
 *      rectangle de -2 000 000 px a +2 000 000 px est lent et perd en precision ;
 *      on le coupe aux bords en signalant qu il deborde.
 *
 * Ce module ne connait ni React ni Canvas : il est purement calculatoire, donc
 * testable et executable hors du thread d interface.
 */
import type { SequenceDoc, TrackDoc } from '@valideo/project-model';
import { clipEnd, clipsInRange } from '@valideo/timeline-model';
import type { DetailPolicy, Viewport } from './viewport.js';
import { detailPolicy, timeToX, visibleRange } from './viewport.js';

export interface TrackLayout {
  readonly trackId: string;
  readonly kind: 'video' | 'audio';
  readonly name: string;
  readonly index: number;
  /** Ordonnee du haut de la piste, en pixels, defilement vertical applique. */
  readonly y: number;
  readonly height: number;
  readonly locked: boolean;
  readonly enabled: boolean;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly targeted: boolean;
  readonly syncLock: boolean;
}

export interface ClipDrawItem {
  readonly clipId: string;
  readonly trackId: string;
  readonly name: string;
  readonly kind: string;
  /** Coordonnees bornees au viewport. */
  readonly x: number;
  readonly width: number;
  readonly y: number;
  readonly height: number;
  /** Vrai si le clip continue au-dela du bord : ne pas dessiner ce coin arrondi. */
  readonly clippedLeft: boolean;
  readonly clippedRight: boolean;
  readonly selected: boolean;
  readonly enabled: boolean;
  readonly hasEffects: boolean;
  readonly hasKeyframes: boolean;
  readonly linked: boolean;
  readonly speedPercent: number | null;
  readonly label: string | null;
  /** Position et duree reelles, pour les interactions. */
  readonly start: number;
  readonly duration: number;
}

export interface RenderModel {
  readonly tracks: readonly TrackLayout[];
  readonly clips: readonly ClipDrawItem[];
  readonly ticks: readonly number[];
  readonly policy: DetailPolicy;
  readonly playheadX: number | null;
  readonly contentHeight: number;
  /** Nombre de clips ecartes par la virtualisation. Sert au panneau de performance. */
  readonly culled: number;
}

export interface RenderOptions {
  readonly verticalScroll?: number;
  /** Hauteur de la zone visible, pour ne pas produire les pistes hors champ. */
  readonly viewportHeight?: number;
  readonly selection?: ReadonlySet<string>;
  readonly playhead?: number | null;
  readonly ticks?: readonly number[];
  /** Espacement vertical entre pistes. */
  readonly trackGap?: number;
}

/**
 * Ordre d empilement a l ecran : les pistes video en haut, V1 juste au-dessus
 * de la zone audio, les pistes audio en dessous, A1 en premier. C est la
 * convention de tous les NLE.
 */
export function orderTracks(sequence: SequenceDoc): TrackDoc[] {
  const video = sequence.tracks.filter((t) => t.kind === 'video').sort((a, b) => b.index - a.index);
  const audio = sequence.tracks.filter((t) => t.kind === 'audio').sort((a, b) => a.index - b.index);
  return [...video, ...audio];
}

export function trackLayout(sequence: SequenceDoc, options: RenderOptions = {}): TrackLayout[] {
  const gap = options.trackGap ?? 1;
  const scroll = options.verticalScroll ?? 0;
  let y = -scroll;
  const out: TrackLayout[] = [];
  for (const track of orderTracks(sequence)) {
    out.push({
      trackId: track.id,
      kind: track.kind,
      name: track.name,
      index: track.index,
      y,
      height: track.height,
      locked: track.locked,
      enabled: track.enabled,
      muted: track.muted,
      solo: track.solo,
      targeted: track.targeted,
      syncLock: track.syncLock,
    });
    y += track.height + gap;
  }
  return out;
}

function speedPercentOf(clip: { speed: { n: number; d: number } }): number | null {
  if (clip.speed.n === clip.speed.d) return null;
  return (clip.speed.n / clip.speed.d) * 100;
}

/** Construit la liste des elements visibles. C est la fonction appelee a chaque image. */
export function buildRenderModel(
  sequence: SequenceDoc,
  vp: Viewport,
  options: RenderOptions = {},
): RenderModel {
  const layouts = trackLayout(sequence, options);
  const policy = detailPolicy(vp);
  const { start, end } = visibleRange(vp);
  const selection = options.selection ?? new Set<string>();
  const viewportHeight = options.viewportHeight ?? Number.POSITIVE_INFINITY;

  const clips: ClipDrawItem[] = [];
  let culled = 0;

  // Index par identifiant : sans lui, retrouver la piste de chaque calque serait
  // quadratique et couterait cher des 50 pistes.
  const byId = new Map<string, TrackDoc>();
  for (const track of sequence.tracks) byId.set(track.id, track);

  for (const layout of layouts) {
    const track = byId.get(layout.trackId);
    if (track === undefined) continue;
    // Virtualisation verticale : une piste hors champ ne produit aucun element.
    if (layout.y + layout.height < 0 || layout.y > viewportHeight) {
      culled += track.clips.length;
      continue;
    }

    const visible = clipsInRange(track, start, end);
    culled += track.clips.length - visible.length;

    for (const clip of visible) {
      const rawX = timeToX(vp, clip.start);
      const rawRight = timeToX(vp, clipEnd(clip));
      const x = Math.max(0, rawX);
      const right = Math.min(vp.width, rawRight);
      clips.push({
        clipId: clip.id,
        trackId: track.id,
        name: clip.name,
        kind: clip.kind,
        x,
        width: Math.max(1, right - x),
        y: layout.y,
        height: layout.height,
        clippedLeft: rawX < 0,
        clippedRight: rawRight > vp.width,
        selected: selection.has(clip.id),
        enabled: clip.enabled,
        hasEffects: clip.effects.length > 0,
        hasKeyframes:
          clip.opacity.keyframes.length > 0 ||
          clip.transform.position.keyframes.length > 0 ||
          clip.transform.scale.keyframes.length > 0 ||
          clip.transform.rotation.keyframes.length > 0,
        linked: clip.linkGroup !== null,
        speedPercent: speedPercentOf(clip),
        label: clip.label,
        start: clip.start,
        duration: clip.duration,
      });
    }
  }

  const lastLayout = layouts[layouts.length - 1];
  const playhead = options.playhead ?? null;
  const playheadX = playhead === null ? null : timeToX(vp, playhead);

  return {
    tracks: layouts,
    clips,
    ticks: options.ticks ?? [],
    policy,
    playheadX: playheadX !== null && playheadX >= 0 && playheadX <= vp.width ? playheadX : null,
    contentHeight:
      lastLayout === undefined
        ? 0
        : lastLayout.y + lastLayout.height + (options.verticalScroll ?? 0),
    culled,
  };
}

// ------------------------------------------------------------- Interactions

export type HitKind = 'clip' | 'clipEdgeIn' | 'clipEdgeOut' | 'track' | 'empty';

export interface Hit {
  readonly kind: HitKind;
  readonly clipId: string | null;
  readonly trackId: string | null;
  readonly frame: number;
}

/**
 * Ce que le pointeur designe.
 *
 * Les zones de trim font `edgePixels` de large, avec une regle importante :
 * sur un clip etroit elles ne peuvent jamais occuper plus du tiers de sa
 * largeur, sinon un clip de 6 px devient impossible a saisir autrement qu en
 * trim.
 */
export function hitTest(
  model: RenderModel,
  vp: Viewport,
  x: number,
  y: number,
  edgePixels = 6,
): Hit {
  const frame = Math.floor(vp.scroll + x / vp.pixelsPerFrame);
  const track = model.tracks.find((t) => y >= t.y && y < t.y + t.height);
  if (track === undefined) return { kind: 'empty', clipId: null, trackId: null, frame };

  for (const clip of model.clips) {
    if (clip.trackId !== track.trackId) continue;
    if (x < clip.x || x > clip.x + clip.width) continue;
    const edge = Math.min(edgePixels, clip.width / 3);
    if (!clip.clippedLeft && x <= clip.x + edge) {
      return { kind: 'clipEdgeIn', clipId: clip.clipId, trackId: track.trackId, frame };
    }
    if (!clip.clippedRight && x >= clip.x + clip.width - edge) {
      return { kind: 'clipEdgeOut', clipId: clip.clipId, trackId: track.trackId, frame };
    }
    return { kind: 'clip', clipId: clip.clipId, trackId: track.trackId, frame };
  }
  return { kind: 'track', clipId: null, trackId: track.trackId, frame };
}

/** Clips entierement ou partiellement contenus dans un rectangle de selection. */
export function marqueeSelect(
  model: RenderModel,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string[] {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return model.clips
    .filter((c) => c.x < right && c.x + c.width > left && c.y < bottom && c.y + c.height > top)
    .map((c) => c.clipId);
}
