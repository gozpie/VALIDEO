/**
 * Navigation JKL (section 33).
 *
 * Le geste de reference du montage au clavier. Le modele retenu tient en un
 * entier signe, `step` :
 *
 *   step = 0   -> arret
 *   step > 0   -> avant,  a la vitesse ladder[step - 1]
 *   step < 0   -> arriere, a la vitesse ladder[-step - 1]
 *
 * L incremente, J decremente, K remet a zero. Ce seul modele produit tout le
 * comportement attendu d un NLE :
 *
 *   L        -> 1x avant          LL   -> 2x       LLL -> 3x
 *   depuis 3x, J -> 2x            (la touche opposee RALENTIT)
 *   depuis 1x, J -> arret         puis J -> 1x arriere
 *
 * K maintenu transforme J et L en lecture au ralenti, comme sur un banc de
 * montage.
 */

/** Paliers de vitesse. Le premier appui donne le premier palier. */
export const DEFAULT_LADDER: readonly number[] = [1, 2, 3, 4, 8];

export type ShuttleState = 'stopped' | 'forward' | 'reverse' | 'slowForward' | 'slowReverse';

export interface ShuttleOptions {
  readonly ladder?: readonly number[];
  /** Vitesse obtenue avec K maintenu. */
  readonly slowRate?: number;
}

export class ShuttleController {
  private step = 0;
  private kHeld = false;
  private slow = 0;
  private readonly ladder: readonly number[];
  private readonly slowRate: number;

  constructor(options: ShuttleOptions = {}) {
    this.ladder = options.ladder ?? DEFAULT_LADDER;
    this.slowRate = options.slowRate ?? 0.5;
  }

  pressL(): void {
    if (this.kHeld) {
      this.slow = 1;
      this.step = 0;
      return;
    }
    this.slow = 0;
    this.step = Math.min(this.step + 1, this.ladder.length);
  }

  pressJ(): void {
    if (this.kHeld) {
      this.slow = -1;
      this.step = 0;
      return;
    }
    this.slow = 0;
    this.step = Math.max(this.step - 1, -this.ladder.length);
  }

  pressK(): void {
    this.kHeld = true;
    this.step = 0;
    this.slow = 0;
  }

  releaseK(): void {
    this.kHeld = false;
    this.slow = 0;
  }

  /** Bascule lecture / pause, sans toucher au palier de shuttle. */
  togglePlay(): void {
    this.slow = 0;
    this.step = this.step === 0 ? 1 : 0;
  }

  stop(): void {
    this.step = 0;
    this.slow = 0;
  }

  /** Vitesse signee. Negative en lecture arriere, 0 a l arret. */
  rate(): number {
    if (this.slow !== 0) return this.slow * this.slowRate;
    if (this.step === 0) return 0;
    const speed = this.ladder[Math.abs(this.step) - 1] ?? 1;
    return this.step > 0 ? speed : -speed;
  }

  state(): ShuttleState {
    const r = this.rate();
    if (r === 0) return 'stopped';
    if (this.slow > 0) return 'slowForward';
    if (this.slow < 0) return 'slowReverse';
    return r > 0 ? 'forward' : 'reverse';
  }

  isPlaying(): boolean {
    return this.rate() !== 0;
  }

  /** Palier courant, pour l affichage « 2x » du moniteur. */
  currentStep(): number {
    return this.step;
  }
}

export interface AudioDuringShuttle {
  /** Faut-il faire entendre le son a cette vitesse ? */
  readonly audible: boolean;
  /** Vitesse a appliquer au son. */
  readonly rate: number;
  /** Faut-il corriger la hauteur pour rester intelligible ? */
  readonly preservePitch: boolean;
}

export interface ShuttleAudioOptions {
  /** Au-dela de cette vitesse, le son devient inexploitable. */
  readonly maxAudibleRate?: number;
  /** Correction de hauteur, option de la section 32. */
  readonly preservePitch?: boolean;
  /** Le son en lecture arriere est rarement souhaite. */
  readonly audibleInReverse?: boolean;
}

/**
 * Que faire du son pendant un shuttle (section 32).
 *
 * Au-dela de quelques fois la vitesse nominale, le son n apporte plus rien et
 * devient penible : on le coupe plutot que de produire un artefact.
 */
export function audioDuringShuttle(
  rate: number,
  options: ShuttleAudioOptions = {},
): AudioDuringShuttle {
  const maxAudible = options.maxAudibleRate ?? 2;
  const preservePitch = options.preservePitch ?? false;
  const audibleInReverse = options.audibleInReverse ?? true;

  if (rate === 0) return { audible: false, rate: 0, preservePitch };
  if (rate < 0 && !audibleInReverse) return { audible: false, rate, preservePitch };
  if (Math.abs(rate) > maxAudible) return { audible: false, rate, preservePitch };
  return { audible: true, rate, preservePitch };
}
