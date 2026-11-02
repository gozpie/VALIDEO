import { z } from 'zod';

/** Tolérance utilisée pour vérifier qu'un quaternion est unitaire. */
export const QUATERNION_NORM_TOLERANCE = 1e-4;

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

const finite = () => z.number().refine(Number.isFinite, { message: 'Nombre fini attendu' });

export const Vec3 = z.tuple([finite(), finite(), finite()]);
export type Vec3 = z.infer<typeof Vec3>;

/** Quaternion unitaire, ordre XYZW (convention glTF). */
export const Quaternion = z
  .tuple([finite(), finite(), finite(), finite()])
  .refine(([x, y, z, w]) => Math.abs(Math.hypot(x, y, z, w) - 1) <= QUATERNION_NORM_TOLERANCE, {
    message: 'Le quaternion doit être normalisé (norme = 1)',
  });
export type Quaternion = z.infer<typeof Quaternion>;

/** Couleur RGB dans l'espace de travail linéaire de la scène (pas sRGB). */
export const LinearRgb = z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]);
export type LinearRgb = z.infer<typeof LinearRgb>;

export const UnitInterval = z.number().min(0).max(1);

/** Numéro de frame : le temps canonique est toujours un entier, jamais des secondes flottantes. */
export const Frame = z.int().min(0);
export type Frame = z.infer<typeof Frame>;

/** Cadence exprimée en rationnel pour représenter exactement 23.976 (24000/1001), 29.97, etc. */
export const FrameRate = z.object({
  numerator: z.int().positive(),
  denominator: z.int().positive(),
});
export type FrameRate = z.infer<typeof FrameRate>;

export const Transform = z.object({
  position: Vec3,
  rotation: Quaternion,
  scale: Vec3,
});
export type Transform = z.infer<typeof Transform>;

export const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};
