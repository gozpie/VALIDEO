/**
 * L'image du film à un instant donné, en couches à empiler du bas vers le haut.
 *
 * Fonction PURE, sans navigateur : le moniteur la dessine, et l'export devra produire la même chose.
 */
import type { BlendMode, ClipDoc, SequenceDoc, TitleDoc, TrackDoc } from '@valideo/project-model';
import { clipAt, nombreA, transitionsEffectives, vecteurA } from '@valideo/timeline-model';

export interface CalqueComposition {
  readonly clipId: string;
  readonly nature: 'media' | 'titre' | 'attente';
  readonly nom: string;
  readonly mediaId: string | null;
  readonly secondesSource: number;
  readonly titre: TitleDoc | null;
  /** De 0 à 1. */
  readonly opacite: number;
  readonly fusion: BlendMode;
  /** Décalage du centre, en pixels du cadre. */
  readonly position: readonly [number, number];
  /** 1 : l'image tient juste dans le cadre. */
  readonly echelle: readonly [number, number];
  /** En degrés. */
  readonly rotation: number;
}

export interface CouchePiste {
  readonly trackId: string;
  readonly sortant: CalqueComposition | null;
  readonly entrant: CalqueComposition | null;
  /** `null` : l'entrant seul, sans transition. Progression entre 0 et 1, sans jamais les atteindre. */
  readonly transition: { readonly type: string; readonly progression: number } | null;
}

export interface SourcesComposition {
  /** Cadence d'un média, en images par seconde (0 : inconnue). */
  readonly cadenceSource: (mediaId: string) => number;
  /** Durée d'un média en secondes (0 : image fixe, sans limite). */
  readonly dureeSource: (mediaId: string) => number;
}

function secondesDansSource(
  clip: ClipDoc,
  mediaId: string,
  image: number,
  cadenceSequence: number,
  sources: SourcesComposition,
): number | null {
  const cadence = sources.cadenceSource(mediaId);
  if (cadence <= 0) return null;
  const vitesse = clip.speed.n / clip.speed.d;
  const ecoule = ((image - clip.start) * vitesse) / cadenceSequence;
  const brut = clip.sourceIn / cadence + (clip.reverse ? -ecoule : ecoule);
  // Hors du média, l'image se fige : une transition peut déborder sur ce qui n'existe pas.
  const duree = sources.dureeSource(mediaId);
  const maximum = duree > 0 ? Math.max(0, duree - 1 / cadence) : brut;
  return Math.max(0, Math.min(maximum, brut));
}

function calque(
  clip: ClipDoc,
  image: number,
  cadenceSequence: number,
  sources: SourcesComposition,
): CalqueComposition | null {
  if (!clip.enabled) return null;
  // Une image de débord (transition) reste bornée au clip pour les réglages animés.
  const t = Math.max(0, Math.min(clip.duration - 1, image - clip.start));
  const commun = {
    clipId: clip.id,
    nom: clip.name,
    opacite: Math.max(0, Math.min(1, nombreA(clip.opacity, t, 100) / 100)),
    fusion: clip.blendMode,
    position: vecteurA(clip.transform.position, t, [0, 0]),
    echelle: echelleEn(vecteurA(clip.transform.scale, t, [100, 100])),
    rotation: nombreA(clip.transform.rotation, t, 0),
  };
  if (clip.kind === 'title') {
    return {
      ...commun,
      nature: 'titre',
      mediaId: null,
      secondesSource: 0,
      titre: clip.title,
    };
  }
  if (clip.mediaId === null) {
    return clip.kind === 'colorMatte'
      ? { ...commun, nature: 'attente', mediaId: null, secondesSource: 0, titre: null }
      : null;
  }
  const secondes = secondesDansSource(clip, clip.mediaId, image, cadenceSequence, sources);
  if (secondes === null) return null;
  return {
    ...commun,
    nature: 'media',
    mediaId: clip.mediaId,
    secondesSource: secondes,
    titre: null,
  };
}

function echelleEn(pourcents: readonly [number, number]): readonly [number, number] {
  return [pourcents[0] / 100, pourcents[1] / 100];
}

function coucheDePiste(
  piste: TrackDoc,
  image: number,
  cadenceSequence: number,
  sources: SourcesComposition,
): CouchePiste | null {
  const transition = transitionsEffectives(piste).find((t) => image >= t.debut && image < t.fin);
  if (transition !== undefined) {
    const sortant =
      transition.de === null ? null : calque(transition.de, image, cadenceSequence, sources);
    const entrant =
      transition.vers === null ? null : calque(transition.vers, image, cadenceSequence, sources);
    if (sortant !== null || entrant !== null) {
      return {
        trackId: piste.id,
        sortant,
        entrant,
        transition: {
          type: transition.type,
          progression: (image - transition.debut + 1) / (transition.fin - transition.debut + 1),
        },
      };
    }
  }
  const clip = clipAt(piste, image);
  if (clip === undefined) return null;
  const seul = calque(clip, image, cadenceSequence, sources);
  return seul === null
    ? null
    : { trackId: piste.id, sortant: null, entrant: seul, transition: null };
}

/** Couches visibles à cette image, de la piste la plus basse à la plus haute. */
export function composerImage(
  sequence: SequenceDoc,
  image: number,
  sources: SourcesComposition,
): readonly CouchePiste[] {
  const cadence = sequence.timebase.rate.n / sequence.timebase.rate.d;
  const couches: CouchePiste[] = [];
  const pistes = sequence.tracks
    .filter((t) => t.kind === 'video' && t.enabled)
    .sort((a, b) => a.index - b.index);
  for (const piste of pistes) {
    const couche = coucheDePiste(piste, image, cadence, sources);
    if (couche !== null) couches.push(couche);
  }
  return couches;
}
