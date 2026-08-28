/**
 * Planification des segments audio a jouer (section 22).
 *
 * Fonction PURE : elle ne touche ni a Web Audio ni au temps reel. Elle repond a
 * une seule question, celle qui est difficile : « pour la fenetre de timeline
 * [de, a[, quels morceaux de quels fichiers faut-il jouer, a quel instant, a
 * partir de quel endroit du fichier, et a quel gain ? »
 *
 * Toute la conversion timeline -> source passe par le rationnel exact de
 * `time-core`. Une erreur d une seule image ici s entendrait immediatement
 * comme un decalage image/son.
 */
import type { SequenceDoc, TrackDoc } from '@valideo/project-model';
import { clipEnd, clipsInRange } from '@valideo/timeline-model';
import type { Rational } from '@valideo/time-core';
import { div, rational, toNumber } from '@valideo/time-core';

export interface SegmentAudio {
  readonly clipId: string;
  readonly trackId: string;
  readonly mediaId: string;
  /** Instant de debut sur la timeline, en secondes depuis le debut de sequence. */
  readonly debutTimeline: number;
  /** Duree occupee sur la timeline, en secondes. */
  readonly dureeTimeline: number;
  /** Endroit du fichier ou commencer, en secondes. */
  readonly offsetSource: number;
  /** Facteur de vitesse applique a la lecture. */
  readonly vitesse: number;
  /** Gain lineaire, deja combine avec l etat de la piste. */
  readonly gain: number;
}

export interface SegmentIgnore {
  readonly clipId: string;
  readonly raison: string;
}

export interface PlanAudio {
  readonly segments: readonly SegmentAudio[];
  /** Clips qui auraient du sonner mais que le moteur ne sait pas jouer. */
  readonly ignores: readonly SegmentIgnore[];
}

function dbVersLineaire(db: number): number {
  return 10 ** (db / 20);
}

/** Gain constant d un clip. Les keyframes de volume ne sont pas encore evalues. */
function gainDuClip(clip: {
  audio: { gainDb: { value: unknown; keyframes: readonly unknown[] } };
}): {
  gain: number;
  automatise: boolean;
} {
  const parametre = clip.audio.gainDb;
  const valeur = typeof parametre.value === 'number' ? parametre.value : 0;
  return { gain: dbVersLineaire(valeur), automatise: parametre.keyframes.length > 0 };
}

/** Pistes audio effectivement audibles : le solo, s il existe, prime sur tout. */
export function pistesAudibles(sequence: SequenceDoc): TrackDoc[] {
  const audio = sequence.tracks.filter((t) => t.kind === 'audio');
  const solo = audio.filter((t) => t.solo);
  const retenues = solo.length > 0 ? solo : audio;
  return retenues.filter((t) => !t.muted && t.enabled);
}

export interface OptionsPlan {
  /** Debut de la fenetre, en images de sequence. */
  readonly de: number;
  /** Fin de la fenetre, exclue, en images de sequence. */
  readonly a: number;
  /** Cadence de la source d un media, pour convertir son point d entree. */
  readonly cadenceSource: (mediaId: string) => Rational | null;
}

/**
 * Construit le plan de lecture pour une fenetre de timeline.
 *
 * Un clip a cheval sur le debut de la fenetre est TRONQUE : on entre dans le
 * fichier au bon endroit plutot que de le reprendre depuis son debut. C est ce
 * qui permet de lancer la lecture au milieu d un plan sans artefact.
 */
export function planifierAudio(sequence: SequenceDoc, options: OptionsPlan): PlanAudio {
  const { de, a } = options;
  const segments: SegmentAudio[] = [];
  const ignores: SegmentIgnore[] = [];
  if (a <= de) return { segments, ignores };

  const cadenceSequence = rational(sequence.timebase.rate.n, sequence.timebase.rate.d);
  const secondesParImage = toNumber(div(rational(1), cadenceSequence));

  for (const piste of pistesAudibles(sequence)) {
    for (const clip of clipsInRange(piste, de, a)) {
      if (!clip.enabled) continue;
      if (clip.mediaId === null) {
        ignores.push({ clipId: clip.id, raison: "Ce clip n'a pas de média associé." });
        continue;
      }
      if (clip.reverse) {
        // Web Audio ne sait pas lire un tampon a l envers. Plutot que de jouer
        // le clip a l endroit -- ce qui serait faux et inaudible comme erreur --
        // on ne le joue pas et on le signale (section 1003).
        ignores.push({
          clipId: clip.id,
          raison: 'La lecture inversée du son n’est pas encore implémentée.',
        });
        continue;
      }

      const cadenceSource = options.cadenceSource(clip.mediaId);
      if (cadenceSource === null) {
        ignores.push({ clipId: clip.id, raison: 'La cadence de la source est inconnue.' });
        continue;
      }

      const vitesse = toNumber(rational(clip.speed.n, clip.speed.d));
      if (vitesse <= 0) {
        ignores.push({ clipId: clip.id, raison: 'Vitesse nulle ou négative.' });
        continue;
      }

      // Portion du clip qui tombe dans la fenetre demandee.
      const debutImage = Math.max(clip.start, de);
      const finImage = Math.min(clipEnd(clip), a);
      if (finImage <= debutImage) continue;

      const imagesDepuisDebutDuClip = debutImage - clip.start;

      // Position dans le fichier : point d entree + ce que le clip a deja
      // consomme, converti a la cadence de la source et corrige de la vitesse.
      const entreeSecondes = toNumber(div(rational(clip.sourceIn), cadenceSource));
      const consommeSecondes = imagesDepuisDebutDuClip * secondesParImage * vitesse;

      const { gain, automatise } = gainDuClip(clip);
      if (automatise) {
        ignores.push({
          clipId: clip.id,
          raison:
            'Le volume est animé par des keyframes, qui ne sont pas encore évaluées ; le gain de départ est appliqué.',
        });
      }

      segments.push({
        clipId: clip.id,
        trackId: piste.id,
        mediaId: clip.mediaId,
        debutTimeline: debutImage * secondesParImage,
        dureeTimeline: (finImage - debutImage) * secondesParImage,
        offsetSource: entreeSecondes + consommeSecondes,
        vitesse,
        gain,
      });
    }
  }

  segments.sort((x, y) => x.debutTimeline - y.debutTimeline || x.trackId.localeCompare(y.trackId));
  return { segments, ignores };
}
