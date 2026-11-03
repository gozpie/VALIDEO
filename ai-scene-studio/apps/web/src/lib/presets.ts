import type { Fps, Resolution } from '@ass/api-client';

export const FPS_PRESETS: { label: string; value: Fps }[] = [
  { label: '23,976', value: { numerator: 24000, denominator: 1001 } },
  { label: '24', value: { numerator: 24, denominator: 1 } },
  { label: '25', value: { numerator: 25, denominator: 1 } },
  { label: '29,97', value: { numerator: 30000, denominator: 1001 } },
  { label: '30', value: { numerator: 30, denominator: 1 } },
  { label: '50', value: { numerator: 50, denominator: 1 } },
  { label: '60', value: { numerator: 60, denominator: 1 } },
];

export const RESOLUTION_PRESETS: { label: string; value: Resolution }[] = [
  { label: 'HD 1920×1080', value: { width: 1920, height: 1080 } },
  { label: 'UHD 3840×2160', value: { width: 3840, height: 2160 } },
  { label: 'Vertical 1080×1920', value: { width: 1080, height: 1920 } },
  { label: 'Carré 1080×1080', value: { width: 1080, height: 1080 } },
  { label: 'Scope 2K 2048×858', value: { width: 2048, height: 858 } },
];

/** Valeur d'un préréglage choisi par son index (liste déroulante), ou la valeur de repli. */
export function presetValue<T>(presets: { value: T }[], index: string, fallback: T): T {
  return presets[Number(index)]?.value ?? fallback;
}

export function formatFps(fps: Fps): string {
  const value = fps.numerator / (fps.denominator ?? 1);
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace('.', ',');
}

/** Durée lisible d'un nombre de frames à une cadence donnée (secondes, arrondi au centième). */
export function formatDuration(frames: number, fps: Fps): string {
  const seconds = (frames * (fps.denominator ?? 1)) / fps.numerator;
  return `${seconds.toFixed(2).replace('.', ',')} s`;
}
