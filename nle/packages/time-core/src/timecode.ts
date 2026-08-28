/**
 * Timecode SMPTE, drop-frame et non drop-frame.
 *
 * Section 12 : le support DF/NDF est imperatif. Toute la conversion se fait en
 * arithmetique entiere exacte, jamais via des secondes flottantes.
 *
 * Rappel du modele : le timecode est une ETIQUETTE, pas une duree. En drop-frame
 * on ne saute aucune image reelle, on saute des etiquettes (2 par minute sauf
 * toutes les 10 minutes en 29.97) pour que l horloge timecode recolle a l horloge
 * murale malgre la cadence 30000/1001.
 */
import type { TimeBase } from './timebase.js';
import { dropFrameCount, nominalRate } from './timebase.js';

export interface TimecodeParts {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly frames: number;
  readonly negative: boolean;
}

export class TimecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimecodeError';
  }
}

interface DropConstants {
  readonly nominal: number;
  readonly drop: number;
  readonly framesPer10Minutes: number;
  readonly framesPerMinute: number;
}

function constantsFor(tb: TimeBase): DropConstants {
  const nominal = nominalRate(tb.rate);
  const drop = tb.mode === 'DF' ? dropFrameCount(tb.rate) : 0;
  return {
    nominal,
    drop,
    framesPer10Minutes: nominal * 600 - drop * 9,
    framesPerMinute: nominal * 60 - drop,
  };
}

/** Nombre d images reelles dans une heure de timecode pour cette timebase. */
export function framesPerHour(tb: TimeBase): number {
  const c = constantsFor(tb);
  return c.nominal * 3600 - c.drop * 54;
}

/** Nombre d images reelles dans 24 heures de timecode. */
export function framesPer24Hours(tb: TimeBase): number {
  return framesPerHour(tb) * 24;
}

export interface TimecodeOptions {
  /** Replie le timecode dans [00:00:00:00, 24:00:00:00[ comme un magnetoscope. */
  readonly wrap24?: boolean;
}

/**
 * Numero d image reel -> composantes de timecode.
 * Les heures peuvent depasser 23 (timeline longue) sauf si `wrap24` est demande.
 */
export function frameToParts(
  frame: number,
  tb: TimeBase,
  opts: TimecodeOptions = {},
): TimecodeParts {
  if (!Number.isSafeInteger(frame)) {
    throw new TimecodeError(`Timecode: numero d image non entier (${frame})`);
  }
  const c = constantsFor(tb);
  const negative = frame < 0;
  let f = negative ? -frame : frame;

  if (opts.wrap24 === true) {
    const span = framesPer24Hours(tb);
    f = ((f % span) + span) % span;
  }

  // Reinjection des etiquettes sautees pour retrouver le compteur nominal.
  if (c.drop > 0) {
    const d = Math.floor(f / c.framesPer10Minutes);
    const m = f % c.framesPer10Minutes;
    f += c.drop * 9 * d;
    if (m > c.drop) {
      f += c.drop * Math.floor((m - c.drop) / c.framesPerMinute);
    }
  }

  const frames = f % c.nominal;
  const totalSeconds = Math.floor(f / c.nominal);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return { hours, minutes, seconds, frames, negative: negative && f !== 0 };
}

/** Vrai si ces composantes n existent pas dans ce mode (etiquette sautee en DF). */
export function isDroppedLabel(parts: TimecodeParts, tb: TimeBase): boolean {
  const c = constantsFor(tb);
  if (c.drop === 0) return false;
  return parts.seconds === 0 && parts.minutes % 10 !== 0 && parts.frames < c.drop;
}

/** Composantes de timecode -> numero d image reel. */
export function partsToFrame(parts: TimecodeParts, tb: TimeBase): number {
  const c = constantsFor(tb);
  const { hours, minutes, seconds, frames } = parts;

  if (minutes > 59 || minutes < 0)
    throw new TimecodeError(`Timecode: minutes hors bornes (${minutes})`);
  if (seconds > 59 || seconds < 0)
    throw new TimecodeError(`Timecode: secondes hors bornes (${seconds})`);
  if (frames < 0 || frames >= c.nominal) {
    throw new TimecodeError(
      `Timecode: images hors bornes (${frames}, cadence nominale ${c.nominal})`,
    );
  }
  if (isDroppedLabel(parts, tb)) {
    throw new TimecodeError(
      `Timecode: ${formatParts(parts, tb)} n existe pas en drop-frame ` +
        `(les ${c.drop} premieres images sont sautees a chaque minute non multiple de 10).`,
    );
  }

  const totalMinutes = hours * 60 + minutes;
  const nominalFrames =
    c.nominal * 3600 * hours + c.nominal * 60 * minutes + c.nominal * seconds + frames;
  const dropped = c.drop * (totalMinutes - Math.floor(totalMinutes / 10));
  const value = nominalFrames - dropped;
  return parts.negative ? -value : value;
}

function pad2(v: number): string {
  return v < 10 ? `0${v}` : `${v}`;
}

/** Formate des composantes. Le drop-frame utilise `;` avant les images. */
export function formatParts(parts: TimecodeParts, tb: TimeBase): string {
  const sep = tb.mode === 'DF' ? ';' : ':';
  const sign = parts.negative ? '-' : '';
  const hh = parts.hours < 100 ? pad2(parts.hours) : `${parts.hours}`;
  return `${sign}${hh}:${pad2(parts.minutes)}:${pad2(parts.seconds)}${sep}${pad2(parts.frames)}`;
}

/** Numero d image reel -> `HH:MM:SS:FF` (ou `HH:MM:SS;FF` en drop-frame). */
export function formatTimecode(frame: number, tb: TimeBase, opts: TimecodeOptions = {}): string {
  return formatParts(frameToParts(frame, tb, opts), tb);
}

const TC_PATTERN = /^(-)?(\d{1,3})[:;.](\d{1,2})[:;.](\d{1,2})[:;.](\d{1,3})$/;

/** Parse un timecode complet `HH:MM:SS:FF`. Accepte `:`, `;` et `.` comme separateurs. */
export function parseTimecode(text: string, tb: TimeBase): number {
  const m = TC_PATTERN.exec(text.trim());
  if (m === null) throw new TimecodeError(`Timecode: format non reconnu "${text}"`);
  return partsToFrame(
    {
      negative: m[1] === '-',
      hours: Number(m[2]),
      minutes: Number(m[3]),
      seconds: Number(m[4]),
      frames: Number(m[5]),
    },
    tb,
  );
}

/**
 * Saisie timecode telle qu attendue par un monteur (section 16).
 *
 * Formes acceptees, `current` etant la position courante en images :
 *   `01:12:32:15`  timecode absolu
 *   `1512`         chiffres cales a droite -> 00:00:15:12
 *   `+10` / `-10`  deplacement relatif en images
 *   `+1:00`        deplacement relatif de 1 seconde et 0 image
 *   `.`            position courante (aucun changement)
 */
export function parseTimecodeEntry(text: string, tb: TimeBase, current = 0): number {
  const raw = text.trim();
  if (raw === '' || raw === '.') return current;

  const relative = raw.startsWith('+') || raw.startsWith('-');
  const sign = raw.startsWith('-') ? -1 : 1;
  const body = relative ? raw.slice(1).trim() : raw;

  const digitsOnly = /^\d+$/.test(body.replace(/[:;.]/g, ''));
  if (!digitsOnly) throw new TimecodeError(`Timecode: saisie non reconnue "${text}"`);

  const c = constantsFor(tb);
  const groups =
    body.includes(':') || body.includes(';') || body.includes('.')
      ? body.split(/[:;.]/).map((g) => Number(g === '' ? 0 : g))
      : splitRightAligned(body);

  if (groups.length > 4) throw new TimecodeError(`Timecode: trop de champs dans "${text}"`);

  // Cale les groupes a droite : [.., HH, MM, SS, FF]
  const padded = [0, 0, 0, 0];
  for (let i = 0; i < groups.length; i += 1) {
    padded[4 - groups.length + i] = groups[i] ?? 0;
  }
  const [hours, minutes, seconds, frames] = padded as [number, number, number, number];

  if (relative) {
    // En relatif on compte des images reelles, sans etiquette sautee.
    const delta = ((hours * 60 + minutes) * 60 + seconds) * c.nominal + frames;
    return current + sign * delta;
  }

  return partsToFrame({ hours, minutes, seconds, frames, negative: false }, tb);
}

/** `"1512"` -> [15, 12] ; `"11512"` -> [1, 15, 12]. */
function splitRightAligned(digits: string): number[] {
  const out: number[] = [];
  let end = digits.length;
  while (end > 0) {
    const start = Math.max(0, end - 2);
    out.unshift(Number(digits.slice(start, end)));
    end = start;
  }
  return out.slice(-4);
}
