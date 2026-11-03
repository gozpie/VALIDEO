import type { LinearRgb } from '@ass/scene-schema';
import { Color } from 'three';
import { linearColor } from '@ass/scene-engine/three';

/** Couleur linéaire de la scène → « #rrggbb » sRGB pour un sélecteur de couleur. */
export function linearToHex(color: LinearRgb): string {
  return `#${linearColor(color).getHexString()}`;
}

/** « #rrggbb » sRGB → couleur linéaire (Three.js convertit vers l'espace de travail linéaire). */
export function hexToLinear(hex: string): LinearRgb {
  const color = new Color(hex);
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return [round(color.r), round(color.g), round(color.b)];
}
