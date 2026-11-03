/**
 * Interpolations élémentaires. Aucune dépendance (ni Three.js ni horloge) : le résultat ne dépend
 * que des entrées, ce qui rend l'évaluation déterministe et identique sur toutes les machines.
 */
import type { Interpolation, Keyframe } from '@ass/scene-schema';

export type Quat = [number, number, number, number];
export type Value = number | boolean | [number, number, number] | Quat;

/** Courbes d'accélération cubiques (t ∈ [0, 1] → [0, 1]). */
export const EASINGS = {
  ease_in: (t: number) => t * t * t,
  ease_out: (t: number) => 1 - (1 - t) ** 3,
  ease_in_out: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
} as const;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Slerp par le plus court chemin (q et −q représentent la même rotation). */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    [bx, by, bz, bw] = [-bx, -by, -bz, -bw];
    cos = -cos;
  }
  let wa: number;
  let wb: number;
  if (cos > 0.9995) {
    // Rotations quasi identiques : interpolation linéaire normalisée (stable numériquement).
    wa = 1 - t;
    wb = t;
  } else {
    const angle = Math.acos(cos);
    const sin = Math.sin(angle);
    wa = Math.sin((1 - t) * angle) / sin;
    wb = Math.sin(t * angle) / sin;
  }
  const q: Quat = [
    wa * a[0] + wb * bx,
    wa * a[1] + wb * by,
    wa * a[2] + wb * bz,
    wa * a[3] + wb * bw,
  ];
  const norm = Math.hypot(...q);
  return [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm];
}

const cubic = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/**
 * Bézier cubique en temps et en valeur entre deux clés. Les poignées sont relatives à leur clé ;
 * leur décalage temporel est borné au segment pour garantir une courbe fonction du temps. Sans
 * poignée, le point de contrôle est placé au tiers du segment (segment rectiligne).
 */
export function bezierSegment(
  start: Keyframe,
  end: Keyframe,
  frame: number,
  components: number,
): number[] {
  const span = end.frame - start.frame;
  const v0 = toArray(start.value, components);
  const v1 = toArray(end.value, components);
  const out = start.outHandle;
  const inn = end.inHandle;
  const x1 = start.frame + Math.min(Math.max(out ? out.frameOffset : span / 3, 0), span);
  const x2 = end.frame + Math.max(Math.min(inn ? inn.frameOffset : -span / 3, 0), -span);
  // Recherche de t tel que x(t) = frame (x est monotone) : dichotomie, 50 itérations (≈ 1e-15).
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(start.frame, x1, x2, end.frame, mid) < frame) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return v0.map((a, index) => {
    const b = v1[index] ?? 0;
    const c1 = a + (out ? (out.valueOffset[index] ?? 0) : (b - a) / 3);
    const c2 = b + (inn ? (inn.valueOffset[index] ?? 0) : (a - b) / 3);
    return cubic(a, c1, c2, b, t);
  });
}

export function toArray(value: Keyframe['value'], components: number): number[] {
  if (typeof value === 'number') return [value];
  if (typeof value === 'boolean') return [value ? 1 : 0];
  return value.slice(0, components);
}

/** Facteur d'avancement remappé selon l'interpolation (hors Bézier, traité à part). */
export function progress(interpolation: Interpolation, t: number): number {
  if (interpolation === 'step') return 0;
  if (interpolation === 'linear' || interpolation === 'bezier') return t;
  return EASINGS[interpolation](t);
}
