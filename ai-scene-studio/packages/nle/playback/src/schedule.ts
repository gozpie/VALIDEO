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
import { clipEnd, clipsInRange, nombreA, transitionsEffectives } from '@valideo/timeline-model';
import type { TransitionEffective } from '@valideo/timeline-model';
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
  /** Gain lineaire au debut du segment. */
  readonly gain: number;
  /**
   * Evolution du gain sur le segment, en points relies lineairement (temps en secondes de timeline).
   * Vide : le gain reste constant.
   */
  readonly enveloppe: readonly { readonly temps: number; readonly gain: number }[];
  /** Panoramique, de -1 (gauche) a 1 (droite). */
  readonly pan: number;
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

/** Part du fondu a cette image (puissance constante : un fondu croise ne creuse pas le son). */
function partDeFondu(
  clipId: string,
  image: number,
  transitions: readonly TransitionEffective[],
): number {
  let part = 1;
  for (const t of transitions) {
    const x = Math.max(0, Math.min(1, (image - t.debut) / (t.fin - t.debut)));
    if (t.vers?.id === clipId) part *= Math.sin((x * Math.PI) / 2);
    if (t.de?.id === clipId) part *= Math.cos((x * Math.PI) / 2);
  }
  return part;
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
    const transitions = transitionsEffectives(piste);
    // Un clip sonne aussi dans le débord de ses transitions, hors de sa place sur la timeline.
    const candidats = new Map(clipsInRange(piste, de, a).map((c) => [c.id, c]));
    for (const t of transitions) {
      if (t.fin <= de || t.debut >= a) continue;
      if (t.de !== null) candidats.set(t.de.id, t.de);
      if (t.vers !== null) candidats.set(t.vers.id, t.vers);
    }
    for (const clip of candidats.values()) {
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

      // Portion du clip qui tombe dans la fenetre demandee, debords compris.
      const siennes = transitions.filter((t) => t.de?.id === clip.id || t.vers?.id === clip.id);
      const debutClip = Math.min(
        clip.start,
        ...siennes.filter((t) => t.vers?.id === clip.id).map((t) => t.debut),
      );
      const finClip = Math.max(
        clipEnd(clip),
        ...siennes.filter((t) => t.de?.id === clip.id).map((t) => t.fin),
      );
      const debutImage = Math.max(debutClip, de);
      const finImage = Math.min(finClip, a);
      if (finImage <= debutImage) continue;

      // Position dans le fichier : point d entree + ce que le clip a deja
      // consomme, converti a la cadence de la source et corrige de la vitesse.
      const entreeSecondes = toNumber(div(rational(clip.sourceIn), cadenceSource));
      const consommeSecondes = (debutImage - clip.start) * secondesParImage * vitesse;

      const gainA = (image: number): number => {
        const t = Math.max(0, Math.min(clip.duration - 1, image - clip.start));
        return (
          dbVersLineaire(nombreA(clip.audio.gainDb, t, 0)) * partDeFondu(clip.id, image, siennes)
        );
      };

      // Un debord avant le debut du fichier ne peut pas sonner : on commence quand le fichier commence.
      const offsetBrut = entreeSecondes + consommeSecondes;
      const saute = offsetBrut < 0 ? -offsetBrut / vitesse : 0;
      const debutTimeline = debutImage * secondesParImage + saute;
      const dureeTimeline = (finImage - debutImage) * secondesParImage - saute;
      if (dureeTimeline <= 0) continue;

      const anime = clip.audio.gainDb.keyframes.length > 0 || siennes.length > 0;
      const enveloppe: { temps: number; gain: number }[] = [];
      if (anime) {
        for (let image = debutImage; image <= finImage; image += 1) {
          const temps = image * secondesParImage;
          if (temps >= debutTimeline) enveloppe.push({ temps, gain: gainA(image) });
        }
      }

      segments.push({
        clipId: clip.id,
        trackId: piste.id,
        mediaId: clip.mediaId,
        debutTimeline,
        dureeTimeline,
        offsetSource: Math.max(0, offsetBrut),
        vitesse,
        gain: enveloppe[0]?.gain ?? gainA(debutImage),
        enveloppe,
        pan: Math.max(-1, Math.min(1, nombreA(clip.audio.pan, debutImage - clip.start, 0))),
      });
    }
  }

  segments.sort((x, y) => x.debutTimeline - y.debutTimeline || x.trackId.localeCompare(y.trackId));
  return { segments, ignores };
}
