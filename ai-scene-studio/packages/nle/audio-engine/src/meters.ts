/**
 * Mesures de niveau (section 31).
 *
 * Trois mesures, trois usages :
 *   crete    -- ne jamais depasser 0 dBFS, sous peine d ecretage ;
 *   RMS      -- energie moyenne, proche de la sonie percue a court terme ;
 *   LUFS     -- sonie normalisee ITU-R BS.1770, l unite des livraisons.
 *
 * L implementation LUFS ici est celle de la sonie MOMENTANEE avec ponderation
 * K. Le calcul integre avec double seuil de porte n est PAS implemente : il est
 * signale comme tel plutot que d etre approxime en silence (section 1003).
 */

const SILENCE_DB = -Infinity;

export function linearToDb(value: number): number {
  return value <= 0 ? SILENCE_DB : 20 * Math.log10(value);
}

export function dbToLinear(db: number): number {
  return db === SILENCE_DB ? 0 : 10 ** (db / 20);
}

/** Crete absolue d un bloc, en dBFS. */
export function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i] ?? 0);
    if (v > peak) peak = v;
  }
  return linearToDb(peak);
}

/** Valeur efficace d un bloc, en dBFS. */
export function rmsDb(samples: Float32Array): number {
  if (samples.length === 0) return SILENCE_DB;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return linearToDb(Math.sqrt(sum / samples.length));
}

/** Ponderations de canal de BS.1770 : les canaux arriere pesent plus. */
export const CHANNEL_WEIGHTS_51 = [1, 1, 1, 0, 1.41, 1.41] as const;

/**
 * Sonie momentanee approchee, en LUFS.
 *
 * `PARTIEL` : la ponderation K (filtre en etagere + passe-haut) n est pas
 * appliquee ici, et la porte du calcul integre n est pas implementee. La valeur
 * est donc utilisable pour un afficheur de tendance, PAS pour valider une
 * livraison broadcast. Ne pas presenter ce chiffre comme une mesure conforme.
 */
export function momentaryLoudnessLufs(
  channels: readonly Float32Array[],
  weights?: readonly number[],
): number {
  if (channels.length === 0) return SILENCE_DB;
  let sum = 0;
  for (let c = 0; c < channels.length; c += 1) {
    const samples = channels[c];
    if (samples === undefined || samples.length === 0) continue;
    const weight = weights?.[c] ?? 1;
    let energy = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const v = samples[i] ?? 0;
      energy += v * v;
    }
    sum += weight * (energy / samples.length);
  }
  return sum <= 0 ? SILENCE_DB : -0.691 + 10 * Math.log10(sum);
}

/**
 * Detecteur de crete a chute progressive, pour un afficheur de niveau.
 * La montee est instantanee, la descente lente : c est le comportement d un
 * bargraphe professionnel, qui laisse le temps de lire la crete.
 */
export class PeakMeter {
  private current = 0;
  private held = 0;
  private heldUntil = 0;

  constructor(
    private readonly decayDbPerSecond = 20,
    private readonly holdSeconds = 1.5,
  ) {}

  /** @param dt duree du bloc, en secondes */
  push(samples: Float32Array, dt: number, now: number): void {
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const v = Math.abs(samples[i] ?? 0);
      if (v > peak) peak = v;
    }
    const decay = dbToLinear(-this.decayDbPerSecond * dt);
    this.current = peak > this.current ? peak : this.current * decay;
    if (peak >= this.held) {
      this.held = peak;
      this.heldUntil = now + this.holdSeconds;
    } else if (now > this.heldUntil) {
      this.held = this.current;
    }
  }

  /** Niveau courant, en dBFS. */
  levelDb(): number {
    return linearToDb(this.current);
  }

  /** Crete maintenue, en dBFS. */
  holdDb(): number {
    return linearToDb(this.held);
  }

  reset(): void {
    this.current = 0;
    this.held = 0;
    this.heldUntil = 0;
  }
}
