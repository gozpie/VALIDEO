/**
 * Lecture par plage (section 901-1000).
 *
 * Le cahier des charges est explicite : un fichier de plusieurs centaines de
 * gigaoctets ne doit JAMAIS etre charge entierement en memoire. Tout le
 * demultiplexeur ne connait donc du fichier que cette interface : sa taille, et
 * la possibilite d en lire une tranche.
 *
 * La meme abstraction convient a un fichier local, a OPFS, et a une requete
 * HTTP par plage d octets.
 */
export interface RangeReader {
  /** Taille totale, en octets. */
  readonly taille: number;
  /** Lit `longueur` octets a partir de `offset`. */
  lire(offset: number, longueur: number): Promise<Uint8Array>;
}

/** Lecteur sur un tableau deja en memoire. Utile aux tests et aux petits fichiers. */
export class MemoryReader implements RangeReader {
  constructor(private readonly donnees: Uint8Array) {}

  get taille(): number {
    return this.donnees.length;
  }

  lire(offset: number, longueur: number): Promise<Uint8Array> {
    const debut = Math.max(0, Math.min(offset, this.donnees.length));
    const fin = Math.max(debut, Math.min(offset + longueur, this.donnees.length));
    return Promise.resolve(this.donnees.subarray(debut, fin));
  }
}

/**
 * Compte les octets reellement lus. Sert a verifier, par test, que le
 * demultiplexeur ne lit pas tout le fichier.
 */
export class CountingReader implements RangeReader {
  octetsLus = 0;
  appels = 0;

  constructor(private readonly source: RangeReader) {}

  get taille(): number {
    return this.source.taille;
  }

  async lire(offset: number, longueur: number): Promise<Uint8Array> {
    this.appels += 1;
    const donnees = await this.source.lire(offset, longueur);
    this.octetsLus += donnees.length;
    return donnees;
  }
}
