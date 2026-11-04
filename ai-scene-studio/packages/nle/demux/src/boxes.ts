/**
 * Parcours des boites ISO BMFF (MP4, MOV).
 *
 * Un fichier MP4 est un arbre de boites : quatre octets de taille, quatre
 * octets de type, puis le contenu. Une taille de 1 signale une taille etendue
 * sur 64 bits ; une taille de 0 signifie « jusqu a la fin du fichier ».
 */

export interface Boite {
  readonly type: string;
  /** Offset du DEBUT de la boite dans le fichier. */
  readonly offset: number;
  /** Taille totale, en-tete comprise. */
  readonly taille: number;
  /** Offset du contenu, apres l en-tete. */
  readonly offsetContenu: number;
  readonly tailleContenu: number;
}

export class Mp4Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Mp4Error';
  }
}

export function lireType(donnees: Uint8Array, offset: number): string {
  let s = '';
  for (let i = 0; i < 4; i += 1) s += String.fromCharCode(donnees[offset + i] ?? 0);
  return s;
}

export function u8(d: Uint8Array, o: number): number {
  return d[o] ?? 0;
}

export function u16(d: Uint8Array, o: number): number {
  return ((d[o] ?? 0) << 8) | (d[o + 1] ?? 0);
}

export function u24(d: Uint8Array, o: number): number {
  return ((d[o] ?? 0) << 16) | ((d[o + 1] ?? 0) << 8) | (d[o + 2] ?? 0);
}

export function u32(d: Uint8Array, o: number): number {
  // Non signe : le decalage a gauche de JS produirait un negatif au-dela de 2^31.
  return (
    (d[o] ?? 0) * 0x1000000 + (((d[o + 1] ?? 0) << 16) | ((d[o + 2] ?? 0) << 8) | (d[o + 3] ?? 0))
  );
}

export function i32(d: Uint8Array, o: number): number {
  const v = u32(d, o);
  return v >= 0x80000000 ? v - 0x100000000 : v;
}

/**
 * Entier 64 bits. Retourne un `number` : au-dela de 2^53 la valeur serait
 * fausse, donc on leve plutot que de mentir. Un fichier de 9 petaoctets
 * n existe pas ; un offset absurde, si.
 */
export function u64(d: Uint8Array, o: number): number {
  const haut = u32(d, o);
  const bas = u32(d, o + 4);
  const valeur = haut * 0x100000000 + bas;
  if (!Number.isSafeInteger(valeur)) {
    throw new Mp4Error(`Offset 64 bits hors des entiers sûrs à la position ${o}.`);
  }
  return valeur;
}

/** Lit l en-tete d une boite a `offset`. */
export function lireBoite(
  donnees: Uint8Array,
  offset: number,
  offsetFichier = 0,
  limite?: number,
): Boite | null {
  const fin = limite ?? donnees.length;
  if (offset + 8 > fin) return null;

  let taille = u32(donnees, offset);
  const type = lireType(donnees, offset + 4);
  let enTete = 8;

  if (taille === 1) {
    if (offset + 16 > fin) return null;
    taille = u64(donnees, offset + 8);
    enTete = 16;
  } else if (taille === 0) {
    taille = fin - offset;
  }

  if (taille < enTete) {
    throw new Mp4Error(`Boîte « ${type} » de taille ${taille}, inférieure à son en-tête.`);
  }

  return {
    type,
    offset: offsetFichier + offset,
    taille,
    offsetContenu: offsetFichier + offset + enTete,
    tailleContenu: taille - enTete,
  };
}

/** Enumere les boites contenues dans une plage. */
export function boitesDe(
  donnees: Uint8Array,
  debut: number,
  fin: number,
  offsetFichier = 0,
): Boite[] {
  const out: Boite[] = [];
  let position = debut;
  while (position + 8 <= fin) {
    const boite = lireBoite(donnees, position, offsetFichier, fin);
    if (boite === null) break;
    out.push(boite);
    if (boite.taille <= 0) break;
    position += boite.taille;
  }
  return out;
}

/** Premiere boite d un type donne parmi une liste. */
export function trouver(boites: readonly Boite[], type: string): Boite | undefined {
  return boites.find((b) => b.type === type);
}

/** Version et drapeaux d une « full box ». */
export function versionEtDrapeaux(d: Uint8Array, o: number): { version: number; drapeaux: number } {
  return { version: u8(d, o), drapeaux: u24(d, o + 1) };
}
