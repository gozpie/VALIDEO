/**
 * Pyramide de pics audio (section 19).
 *
 * Probleme a resoudre : une heure de son a 48 kHz represente 172 millions
 * d echantillons par canal. Dessiner une forme d onde en parcourant ces
 * echantillons a chaque image de rendu est hors de question, et les recalculer
 * a chaque changement de zoom l est encore plus.
 *
 * Solution : une pyramide de reductions, chacune construite a partir de la
 * PRECEDENTE et non des echantillons d origine. Le cout total de construction
 * reste donc lineaire, et le dessin choisit le niveau adapte au zoom courant.
 *
 * Chaque case retient trois valeurs :
 *   min  et  max  -> l enveloppe, ce qui donne sa silhouette a la forme d onde ;
 *   rms            -> l energie, ce qui donne le remplissage interieur, bien
 *                     plus representatif de la sonie percue que la seule crete.
 *
 * Stockage en entiers 16 bits signes : deux fois plus compact que des
 * flottants, pour une precision tres au-dela de ce qu un ecran peut montrer.
 * La pyramide complete pese environ 3 % de l audio d origine.
 *
 * LIMITE ASSUMEE : au zoom maximal de la timeline, un pixel represente moins
 * d echantillons qu une case du niveau le plus fin. La forme d onde y devient
 * donc legerement escalieree. C est le moment ou le rendu doit lire l audio
 * conforme directement plutot que la pyramide -- descendre la taille de case
 * doublerait le cout memoire pour un gain visible dans un seul cas de zoom.
 */

const INT16_MAX = 32767;

/** Taille de case du niveau le plus fin, en echantillons. */
export const BASE_BUCKET = 64;

/** Facteur de reduction entre deux niveaux consecutifs. */
export const LEVEL_FACTOR = 4;

export interface PeakLevel {
  /** Nombre d echantillons agreges par case. */
  readonly bucket: number;
  /** Nombre de cases par canal. */
  readonly length: number;
  /** min, max, rms entrelaces, par canal : [c0b0min, c0b0max, c0b0rms, c0b1min, ...] */
  readonly data: Int16Array;
}

export interface PeakPyramid {
  readonly channels: number;
  readonly sampleRate: number;
  readonly sampleCount: number;
  readonly levels: readonly PeakLevel[];
}

function toInt16(value: number): number {
  const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
  return Math.trunc(clamped * INT16_MAX);
}

function fromInt16(value: number): number {
  return value / INT16_MAX;
}

/**
 * Construit la pyramide.
 *
 * @param channelData un tableau d echantillons flottants par canal
 * @param levelCount nombre de niveaux, du plus fin au plus grossier
 */
export function buildPeaks(
  channelData: readonly Float32Array[],
  sampleRate: number,
  levelCount = 6,
): PeakPyramid {
  const channels = channelData.length;
  const sampleCount = channels === 0 ? 0 : (channelData[0]?.length ?? 0);

  if (channels === 0 || sampleCount === 0) {
    return { channels, sampleRate, sampleCount, levels: [] };
  }

  const levels: PeakLevel[] = [];

  // Niveau le plus fin : seul a parcourir les echantillons d origine.
  const baseLength = Math.ceil(sampleCount / BASE_BUCKET);
  const base = new Int16Array(baseLength * channels * 3);
  for (let c = 0; c < channels; c += 1) {
    const samples = channelData[c];
    if (samples === undefined) continue;
    for (let b = 0; b < baseLength; b += 1) {
      const from = b * BASE_BUCKET;
      const to = Math.min(from + BASE_BUCKET, sampleCount);
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      let sumSquares = 0;
      for (let i = from; i < to; i += 1) {
        const v = samples[i] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
        sumSquares += v * v;
      }
      const count = to - from;
      const offset = (c * baseLength + b) * 3;
      base[offset] = toInt16(count === 0 ? 0 : min);
      base[offset + 1] = toInt16(count === 0 ? 0 : max);
      base[offset + 2] = toInt16(count === 0 ? 0 : Math.sqrt(sumSquares / count));
    }
  }
  levels.push({ bucket: BASE_BUCKET, length: baseLength, data: base });

  // Niveaux suivants : construits depuis le precedent, jamais depuis les
  // echantillons. C est ce qui garde le cout total lineaire.
  for (let l = 1; l < levelCount; l += 1) {
    const previous = levels[l - 1];
    if (previous === undefined || previous.length <= 1) break;
    const length = Math.ceil(previous.length / LEVEL_FACTOR);
    const data = new Int16Array(length * channels * 3);
    for (let c = 0; c < channels; c += 1) {
      for (let b = 0; b < length; b += 1) {
        const from = b * LEVEL_FACTOR;
        const to = Math.min(from + LEVEL_FACTOR, previous.length);
        let min = INT16_MAX;
        let max = -INT16_MAX;
        let sumSquares = 0;
        let count = 0;
        for (let i = from; i < to; i += 1) {
          const o = (c * previous.length + i) * 3;
          const lo = previous.data[o] ?? 0;
          const hi = previous.data[o + 1] ?? 0;
          const rms = fromInt16(previous.data[o + 2] ?? 0);
          if (lo < min) min = lo;
          if (hi > max) max = hi;
          // Combinaison exacte des RMS : moyenne des carres, puis racine.
          sumSquares += rms * rms;
          count += 1;
        }
        const offset = (c * length + b) * 3;
        data[offset] = count === 0 ? 0 : min;
        data[offset + 1] = count === 0 ? 0 : max;
        data[offset + 2] = count === 0 ? 0 : toInt16(Math.sqrt(sumSquares / count));
      }
    }
    levels.push({ bucket: previous.bucket * LEVEL_FACTOR, length, data });
  }

  return { channels, sampleRate, sampleCount, levels };
}

/**
 * Niveau adapte a un zoom donne.
 *
 * On retient le niveau le plus FIN dont la case tient dans un pixel : chaque
 * pixel agrege alors au moins une case, jamais moins. Prendre plus fin ferait
 * lire des donnees inutiles ; prendre plus grossier ecraserait des cretes que
 * l ecran pourrait montrer.
 */
export function selectLevel(pyramid: PeakPyramid, samplesPerPixel: number): number {
  if (pyramid.levels.length === 0) return -1;
  let chosen = 0;
  for (let i = 0; i < pyramid.levels.length; i += 1) {
    const level = pyramid.levels[i];
    if (level === undefined) break;
    if (level.bucket <= samplesPerPixel) chosen = i;
    else break;
  }
  return chosen;
}

export interface WaveformColumn {
  readonly min: number;
  readonly max: number;
  readonly rms: number;
}

/**
 * Produit exactement `columns` colonnes pour la plage demandee.
 *
 * C est la fonction appelee par le rendu de la timeline : elle ne lit que le
 * niveau adapte, donc un zoom ne provoque AUCUN recalcul de la pyramide
 * (section 19).
 */
export function readWaveform(
  pyramid: PeakPyramid,
  channel: number,
  startSample: number,
  endSample: number,
  columns: number,
): WaveformColumn[] {
  const out: WaveformColumn[] = [];
  if (columns <= 0 || pyramid.levels.length === 0 || channel >= pyramid.channels) return out;

  const from = Math.max(0, Math.min(startSample, pyramid.sampleCount));
  const to = Math.max(from, Math.min(endSample, pyramid.sampleCount));
  const samplesPerColumn = (to - from) / columns;

  const levelIndex = selectLevel(pyramid, samplesPerColumn);
  const level = pyramid.levels[levelIndex];
  if (level === undefined) return out;

  for (let x = 0; x < columns; x += 1) {
    const sampleFrom = from + x * samplesPerColumn;
    const sampleTo = from + (x + 1) * samplesPerColumn;
    const bucketFrom = Math.floor(sampleFrom / level.bucket);
    const bucketTo = Math.max(bucketFrom + 1, Math.ceil(sampleTo / level.bucket));

    let min = INT16_MAX;
    let max = -INT16_MAX;
    let sumSquares = 0;
    let count = 0;
    for (let b = bucketFrom; b < bucketTo && b < level.length; b += 1) {
      const o = (channel * level.length + b) * 3;
      const lo = level.data[o] ?? 0;
      const hi = level.data[o + 1] ?? 0;
      const rms = fromInt16(level.data[o + 2] ?? 0);
      if (lo < min) min = lo;
      if (hi > max) max = hi;
      sumSquares += rms * rms;
      count += 1;
    }
    out.push(
      count === 0
        ? { min: 0, max: 0, rms: 0 }
        : { min: fromInt16(min), max: fromInt16(max), rms: Math.sqrt(sumSquares / count) },
    );
  }
  return out;
}

/** Empreinte memoire de la pyramide, en octets. Sert aux budgets de cache (§58). */
export function pyramidBytes(pyramid: PeakPyramid): number {
  return pyramid.levels.reduce((sum, level) => sum + level.data.byteLength, 0);
}

/**
 * Cout de la pyramide rapporte aux echantillons d origine.
 * Une pyramide qui couterait presque aussi cher que l audio ne servirait a rien.
 */
export function compressionRatio(pyramid: PeakPyramid): number {
  const raw = pyramid.sampleCount * pyramid.channels * 4; // Float32
  return raw === 0 ? 0 : pyramidBytes(pyramid) / raw;
}
