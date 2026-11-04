/**
 * Paramètres animables : valeur constante, ou images clés.
 *
 * Les temps sont en images depuis le début du clip. Avant la première clé et après la dernière, la
 * valeur reste celle de la clé la plus proche. Pures : elles rendent un nouveau paramètre.
 */
import type { KeyframeDoc, ParameterDoc } from '@valideo/project-model';
import { newId } from '@valideo/project-model';

function courbe(interpolation: KeyframeDoc['interpolation'], x: number): number {
  switch (interpolation) {
    case 'hold':
      return 0;
    case 'easeIn':
      return x * x;
    case 'easeOut':
      return 1 - (1 - x) * (1 - x);
    case 'easeInOut':
      return x * x * (3 - 2 * x);
    default:
      return x;
  }
}

function clesTriees(p: ParameterDoc): readonly KeyframeDoc[] {
  return [...p.keyframes].sort((a, b) => a.time - b.time);
}

function valeurCle(k: KeyframeDoc): readonly number[] {
  return typeof k.value === 'number' ? [k.value] : k.value;
}

function evaluer(p: ParameterDoc, temps: number): readonly number[] | null {
  const cles = clesTriees(p);
  const premiere = cles[0];
  const derniere = cles[cles.length - 1];
  if (premiere === undefined || derniere === undefined) return null;
  if (temps <= premiere.time) return valeurCle(premiere);
  if (temps >= derniere.time) return valeurCle(derniere);
  for (let i = 0; i < cles.length - 1; i += 1) {
    const a = cles[i];
    const b = cles[i + 1];
    if (a === undefined || b === undefined || temps >= b.time) continue;
    const x = courbe(a.interpolation, (temps - a.time) / (b.time - a.time));
    const va = valeurCle(a);
    const vb = valeurCle(b);
    return va.map((v, n) => v + ((vb[n] ?? v) - v) * x);
  }
  return valeurCle(derniere);
}

/** Valeur numérique du paramètre à cet instant du clip. */
export function nombreA(p: ParameterDoc, temps: number, defaut: number): number {
  const anime = evaluer(p, temps);
  if (anime !== null) return anime[0] ?? defaut;
  return typeof p.value === 'number' ? p.value : defaut;
}

/** Valeur à deux composantes (position, échelle) à cet instant du clip. */
export function vecteurA(
  p: ParameterDoc,
  temps: number,
  defaut: readonly [number, number],
): readonly [number, number] {
  const brut = evaluer(p, temps) ?? (Array.isArray(p.value) ? p.value : null);
  if (brut === null) return defaut;
  return [brut[0] ?? defaut[0], brut[1] ?? defaut[1]];
}

export function cleA(p: ParameterDoc, temps: number): KeyframeDoc | undefined {
  return p.keyframes.find((k) => k.time === temps);
}

function avecCle(p: ParameterDoc, temps: number, valeur: number | number[]): ParameterDoc {
  const existante = cleA(p, temps);
  const cle: KeyframeDoc = existante ?? {
    id: newId(),
    time: temps,
    value: valeur,
    interpolation: 'linear',
    inHandle: null,
    outHandle: null,
  };
  return {
    ...p,
    keyframes: [...p.keyframes.filter((k) => k.time !== temps), { ...cle, value: valeur }].sort(
      (a, b) => a.time - b.time,
    ),
  };
}

/**
 * Change la valeur : sur un paramètre animé, à l'instant visé (une clé apparaît s'il n'y en a pas) ;
 * sinon partout.
 */
export function ecrireParametre(
  p: ParameterDoc,
  temps: number,
  valeur: number | number[],
): ParameterDoc {
  return p.keyframes.length > 0 ? avecCle(p, temps, valeur) : { ...p, value: valeur };
}

/**
 * Pose ou retire une clé à cet instant. Retirer la dernière rend le paramètre constant, à la valeur
 * qu'il avait là : rien ne saute à l'image.
 */
export function basculerCle(
  p: ParameterDoc,
  temps: number,
  valeur: number | number[],
): ParameterDoc {
  if (cleA(p, temps) === undefined) return avecCle(p, temps, valeur);
  const restantes = p.keyframes.filter((k) => k.time !== temps);
  return restantes.length === 0
    ? { ...p, value: valeur, keyframes: [] }
    : { ...p, keyframes: restantes };
}
