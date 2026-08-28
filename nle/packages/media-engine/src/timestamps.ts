/**
 * Analyse des horodatages d un flux video (section 13).
 *
 * Le piege que cette section decrit : `r_frame_rate` remonte par un demuxeur
 * est une DECLARATION, pas une mesure. Un fichier reellement a cadence variable
 * peut annoncer « 30/1 » au niveau du flux. Ne pas verifier revient a supposer
 * que l image n est a l instant n/30, ce qui desynchronise progressivement tout
 * un montage.
 *
 * On mesure donc les ecarts reels entre horodatages.
 *
 * Deux pieges, tous deux rencontres sur de vrais fichiers :
 *
 * 1. ORDRE DE DECODAGE. Un demuxeur restitue les images dans l ordre ou elles
 *    sont stockees, pas dans l ordre d affichage. Des qu il y a des images B,
 *    la suite des horodatages saute : ...0.40, 0.48, puis 0.44 plus loin. Les
 *    prendre tels quels fait passer un fichier a cadence parfaitement constante
 *    pour un fichier a cadence variable. On les trie donc avant de mesurer.
 *
 * 2. QUANTIFICATION. Les conteneurs arrondissent les horodatages sur leur base
 *    de temps. A 30 images/s dans une base 1/1000, les ecarts alternent entre
 *    33 et 34 ms sans que le fichier soit a cadence variable. Le critere compare
 *    donc l amplitude des ecarts a cette quantification, et non a une tolerance
 *    arbitraire.
 */
import type { Rational } from '@valideo/time-core';
import { approximate, rational, toNumber } from '@valideo/time-core';

export interface TimestampAnalysis {
  /**
   * Nombre d horodatages EXAMINES. Ce n est le nombre total d images du fichier
   * que si `complet` vaut vrai : l analyse ne lit qu une fenetre de tete, ce qui
   * suffit a detecter une cadence variable mais pas a mesurer une duree.
   */
  readonly frameCount: number;
  /** Vrai si la fenetre couvrait tout le fichier. */
  readonly complet: boolean;
  /** Vrai si les durees d image varient au-dela de la quantification du conteneur. */
  readonly variable: boolean;
  /** Cadence deduite de la mediane des ecarts. */
  readonly measuredRate: Rational;
  /** Cadence moyenne sur toute la duree : nombre d images / duree totale. */
  readonly averageRate: Rational;
  readonly minDelta: number;
  readonly maxDelta: number;
  readonly medianDelta: number;
  /**
   * Vrai si deux images portent le meme horodatage. Contrairement au simple
   * desordre -- normal avec des images B --, un doublon est reellement suspect.
   */
  readonly duplicateTimestamps: boolean;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * @param ptsSeconds horodatages de presentation, en secondes, dans l ordre du fichier
 * @param timeBase base de temps du flux : la quantification des horodatages
 * @param complet vrai si la fenetre lue couvrait la totalite du fichier
 */
export function analyzeTimestamps(
  ptsSeconds: readonly number[],
  timeBase: Rational,
  complet = true,
): TimestampAnalysis {
  const count = ptsSeconds.length;
  if (count < 2) {
    return {
      frameCount: count,
      complet,
      variable: false,
      measuredRate: rational(0),
      averageRate: rational(0),
      minDelta: 0,
      maxDelta: 0,
      medianDelta: 0,
      duplicateTimestamps: false,
    };
  }

  // Tri indispensable : la liste arrive en ordre de decodage (voir en-tete).
  const ordered = [...ptsSeconds].sort((a, b) => a - b);

  const deltas: number[] = [];
  let duplicateTimestamps = false;
  for (let i = 1; i < count; i += 1) {
    const d = (ordered[i] ?? 0) - (ordered[i - 1] ?? 0);
    if (d === 0) duplicateTimestamps = true;
    deltas.push(d);
  }

  const sorted = [...deltas].sort((a, b) => a - b);
  const minDelta = sorted[0] ?? 0;
  const maxDelta = sorted[sorted.length - 1] ?? 0;
  const medianDelta = median(sorted);

  // Amplitude imputable a la seule quantification du conteneur : deux pas de
  // base de temps (un a chaque borne de l intervalle).
  const quantization = toNumber(timeBase) * 2;
  const variable = maxDelta - minDelta > quantization + 1e-9;

  const total = (ordered[count - 1] ?? 0) - (ordered[0] ?? 0) + medianDelta;

  return {
    frameCount: count,
    complet,
    variable,
    // Denominateur volontairement borne : une cadence reconstruite depuis des
    // horodatages quantifies doit rester lisible et proche d une cadence
    // standard, pas exhiber une fraction a sept chiffres.
    measuredRate: medianDelta > 0 ? approximate(1 / medianDelta, 1001) : rational(0),
    averageRate: total > 0 ? approximate(count / total, 1001) : rational(0),
    minDelta,
    maxDelta,
    medianDelta,
    duplicateTimestamps,
  };
}
