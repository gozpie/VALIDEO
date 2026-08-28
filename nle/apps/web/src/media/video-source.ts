/**
 * Decodage video par WebCodecs (sections 22, 901-1000).
 *
 * Chaine complete : fichier -> demultiplexeur -> `EncodedVideoChunk` ->
 * `VideoDecoder` -> `VideoFrame` -> canvas.
 *
 * Deux modes, et ils different par leur cout :
 *
 *   SCRUB   -- `imageA` decode a la demande depuis l image cle qui precede.
 *              Un saut long coute donc le decodage d un groupe d images.
 *   LECTURE -- `precharger` decode EN AVANT et garde les images dans un cache
 *              borne. La demande suivante est alors servie sans decoder, ce qui
 *              rend possible une lecture a la cadence de la sequence.
 *
 * Le cache est borne en PIXELS et non en nombre d images : vingt-quatre images
 * de 320x240 coutent 7 Mo, les memes en 4K en couteraient 800 (section 57).
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok } from '@valideo/shared';
import type { EchantillonMp4, FichierMp4, PisteMp4, RangeReader } from '@valideo/demux';
import { demultiplexerMp4, imageCleAvant, premierePiste } from '@valideo/demux';

/** Lecteur par plage sur un `File` : `Blob.slice` ne charge que la tranche demandee. */
export class FileRangeReader implements RangeReader {
  constructor(private readonly fichier: File) {}

  get taille(): number {
    return this.fichier.size;
  }

  async lire(offset: number, longueur: number): Promise<Uint8Array> {
    const tranche = this.fichier.slice(offset, offset + longueur);
    return new Uint8Array(await tranche.arrayBuffer());
  }
}

export interface InfosVideo {
  readonly codec: string;
  readonly largeur: number;
  readonly hauteur: number;
  /** Cadence deduite de la duree mediane des echantillons, en fraction exacte. */
  readonly cadence: { n: number; d: number };
  readonly nombreImages: number;
  readonly timescale: number;
  readonly decodable: boolean;
}

function medianeDurees(echantillons: readonly EchantillonMp4[]): number {
  const durees = echantillons
    .map((e) => e.duree)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (durees.length === 0) return 0;
  return durees[durees.length >> 1] ?? 0;
}

/**
 * Cadence exacte, deduite de la timescale et de la duree d image.
 *
 * C est bien plus fiable que ce qu expose un element video : 12800/512 donne
 * exactement 25, et 24000/1001 reste 24000/1001 au lieu de devenir 23,976.
 */
export function cadenceExacte(piste: PisteMp4): { n: number; d: number } {
  const duree = medianeDurees(piste.echantillons);
  if (duree <= 0) return { n: 25, d: 1 };
  const pgcd = (a: number, b: number): number => (b === 0 ? a : pgcd(b, a % b));
  const g = pgcd(piste.timescale, duree);
  return { n: piste.timescale / g, d: duree / g };
}

export interface OuvertureVideo {
  readonly source: VideoSource;
  readonly infos: InfosVideo;
  readonly avertissements: readonly string[];
}

/**
 * Source video : demultiplexee une fois, decodee a la demande.
 *
 * Le decodeur est CONSERVE entre deux demandes proches : recreer un
 * `VideoDecoder` a chaque image coute bien plus cher que de continuer a
 * l alimenter. Il n est reinitialise que lorsqu on recule ou qu on saute
 * au-dela du groupe d images courant.
 */
export class VideoSource {
  private decodeur: VideoDecoder | null = null;
  /** Images emises par le decodeur pendant la demande en cours. */
  private collecte: VideoFrame[] | null = null;
  /** Cache d images decodees, par index d echantillon. `Map` conserve l ordre. */
  private readonly cache = new Map<number, VideoFrame>();
  private pixelsEnCache = 0;
  /** Budget du cache, en pixels. 64 Mpx : environ 250 Mo en RGBA. */
  private budgetPixels = 64_000_000;
  private derniereImage: VideoFrame | null = null;
  private derniereCle = -1;
  /**
   * File d attente d une seule voie.
   *
   * Un `VideoDecoder` a un ETAT : la position atteinte dans le groupe d images.
   * Deux appels concurrents a `imageA` se marcheraient dessus et rendraient des
   * images fausses, ou aucune. On serialise donc les demandes.
   */
  private file: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly reader: RangeReader,
    readonly fichier: FichierMp4,
    readonly piste: PisteMp4,
    readonly infos: InfosVideo,
  ) {}

  static async ouvrir(fichier: File): Promise<Result<OuvertureVideo, AppError>> {
    const reader = new FileRangeReader(fichier);
    const demux = await demultiplexerMp4(reader);
    if (!demux.ok) return demux;

    const piste = premierePiste(demux.value, 'video');
    if (piste === undefined) {
      return err(appError('MEDIA_UNREADABLE', 'Ce fichier ne contient pas de piste vidéo.'));
    }

    const avertissements = [...demux.value.avertissements];
    const cadence = cadenceExacte(piste);

    let decodable = false;
    if (typeof VideoDecoder !== 'undefined') {
      try {
        const config: VideoDecoderConfig = {
          codec: piste.codec,
          codedWidth: piste.largeur,
          codedHeight: piste.hauteur,
          ...(piste.description === null ? {} : { description: piste.description }),
        };
        decodable = (await VideoDecoder.isConfigSupported(config)).supported === true;
      } catch {
        decodable = false;
      }
    }
    if (!decodable) {
      avertissements.push(
        `Ce navigateur ne sait pas décoder « ${piste.codec} ». Un proxy généré côté serveur sera nécessaire.`,
      );
    }

    const infos: InfosVideo = {
      codec: piste.codec,
      largeur: piste.largeur,
      hauteur: piste.hauteur,
      cadence,
      nombreImages: piste.echantillons.length,
      timescale: piste.timescale,
      decodable,
    };

    return ok({
      source: new VideoSource(reader, demux.value, piste, infos),
      infos,
      avertissements,
    });
  }

  private configurer(): VideoDecoder {
    if (this.decodeur !== null && this.decodeur.state === 'configured') return this.decodeur;
    const decodeur = new VideoDecoder({
      // Le decodeur emet PLUSIEURS images par rafale, sans correspondance
      // un-pour-un avec les appels a `decode`. On les collecte donc toutes et
      // on choisit apres coup ; attendre « la » prochaine image serait faux.
      output: (image) => {
        const collecte = this.collecte;
        if (collecte !== null) collecte.push(image);
        else image.close();
      },
      error: () => {
        this.reinitialiser();
      },
    });
    decodeur.configure({
      codec: this.piste.codec,
      codedWidth: this.piste.largeur,
      codedHeight: this.piste.hauteur,
      ...(this.piste.description === null ? {} : { description: this.piste.description }),
    });
    this.decodeur = decodeur;
    return decodeur;
  }

  private reinitialiser(): void {
    if (this.decodeur !== null && this.decodeur.state !== 'closed') this.decodeur.close();
    this.decodeur = null;
    this.derniereCle = -1;
  }

  /** Convertit un instant en secondes vers les unites de la piste. */
  private versTimescale(secondes: number): number {
    return Math.round(secondes * this.piste.timescale);
  }

  /**
   * Image affichable a l instant demande.
   *
   * Les demandes sont SERIALISEES : un decodeur porte un etat -- la position
   * atteinte dans le groupe d images -- que deux appels concurrents
   * corrompraient.
   */
  imageA(secondes: number): Promise<VideoFrame | null> {
    // Chemin rapide : l image est deja decodee. On en rend un clone, pour que
    // l appelant puisse la fermer sans vider le cache.
    if (this.infos.decodable) {
      const enCache = this.cache.get(this.indexA(secondes));
      if (enCache !== undefined) return Promise.resolve(enCache.clone());
    }
    const suivante = this.file.then(
      () => this.decoderImage(secondes),
      () => this.decoderImage(secondes),
    );
    // La file ne doit jamais rester en echec, sinon toutes les demandes
    // suivantes seraient rejetees d office.
    this.file = suivante.catch(() => undefined);
    return suivante;
  }

  /**
   * On repart de l image cle qui precede la cible, puis on decode en avant :
   * c est la seule facon correcte de decoder un format inter-images.
   */
  private async decoderImage(secondes: number): Promise<VideoFrame | null> {
    if (!this.infos.decodable) return null;
    const echantillons = this.piste.echantillons;
    if (echantillons.length === 0) return null;

    const cible = this.versTimescale(secondes);

    // Echantillon a afficher : le dernier dont le pts ne depasse pas la cible.
    let vise = 0;
    for (const e of echantillons) {
      if (e.pts <= cible) vise = e.index;
      else break;
    }

    const cle = imageCleAvant(this.piste, echantillons[vise]?.pts ?? 0);

    let decodeur: VideoDecoder;
    try {
      decodeur = this.configurer();
    } catch {
      return null;
    }

    // On repart TOUJOURS de l image cle qui precede la cible.
    //
    // Une reprise incrementale -- « j ai deja decode jusqu a l image 7, je
    // continue » -- semble economique, mais elle rend la demande suivante
    // muette quand la cible a deja ete franchie : le decodeur n a alors plus
    // rien a emettre et l affichage reste sur l image precedente. Le gain ne
    // vaut pas ce defaut. La vraie optimisation est un cache d images decodees,
    // qui viendra avec le moteur de lecture temps reel.
    this.derniereCle = cle;
    const depart = cle;

    const collecte: VideoFrame[] = [];
    this.collecte = collecte;

    try {
      for (let i = depart; i <= vise; i += 1) {
        const echantillon = echantillons[i];
        if (echantillon === undefined) continue;
        const octets = await this.reader.lire(echantillon.offset, echantillon.taille);
        decodeur.decode(
          new EncodedVideoChunk({
            type: echantillon.cle ? 'key' : 'delta',
            timestamp: (echantillon.pts / this.piste.timescale) * 1_000_000,
            duration: (echantillon.duree / this.piste.timescale) * 1_000_000,
            data: octets,
          }),
        );
      }
      await decodeur.flush();
    } catch {
      this.collecte = null;
      for (const image of collecte) image.close();
      this.reinitialiser();
      return null;
    }

    this.collecte = null;

    // L image a afficher est celle dont l horodatage est le plus proche SANS
    // depasser la cible ; les autres sont liberees immediatement (section 57).
    const cibleUs = (cible / this.piste.timescale) * 1_000_000;
    let retenue: VideoFrame | null = null;
    const restantes: VideoFrame[] = [];
    for (const image of collecte) {
      if (
        image.timestamp <= cibleUs + 1 &&
        (retenue === null || image.timestamp > retenue.timestamp)
      ) {
        if (retenue !== null) restantes.push(retenue);
        retenue = image;
      } else {
        restantes.push(image);
      }
    }
    if (retenue === null && restantes.length > 0) {
      retenue = restantes.shift() ?? null;
    }
    // Les images voisines sont conservees : un scrub image par image les
    // redemanderait aussitot.
    for (const image of restantes) {
      const index = this.indexParHorodatage(image.timestamp);
      if (index === null) image.close();
      else this.mettreEnCache(index, image);
    }
    if (retenue !== null) {
      const index = this.indexParHorodatage(retenue.timestamp);
      if (index !== null) {
        const clone = retenue.clone();
        this.mettreEnCache(index, retenue);
        return clone;
      }
    }
    return retenue;
  }

  // ------------------------------------------------------------------ cache

  /** Ajuste le budget du cache selon le profil de la machine (section 58). */
  definirBudgetPixels(pixels: number): void {
    this.budgetPixels = Math.max(1_000_000, pixels);
    this.elaguer();
  }

  private coutImage(image: VideoFrame): number {
    return image.displayWidth * image.displayHeight;
  }

  private mettreEnCache(index: number, image: VideoFrame): void {
    const existante = this.cache.get(index);
    if (existante !== undefined) {
      image.close();
      return;
    }
    this.cache.set(index, image);
    this.pixelsEnCache += this.coutImage(image);
    this.elaguer();
  }

  /** Evince les plus anciennes jusqu a rentrer dans le budget. */
  private elaguer(): void {
    for (const [index, image] of this.cache) {
      if (this.pixelsEnCache <= this.budgetPixels) break;
      this.pixelsEnCache -= this.coutImage(image);
      image.close();
      this.cache.delete(index);
    }
  }

  private viderCache(): void {
    for (const image of this.cache.values()) image.close();
    this.cache.clear();
    this.pixelsEnCache = 0;
  }

  /** Etat du cache, pour le panneau de performance (section 104). */
  etatCache(): { images: number; pixels: number; budget: number } {
    return { images: this.cache.size, pixels: this.pixelsEnCache, budget: this.budgetPixels };
  }

  /** Index d echantillon correspondant a un instant. */
  private indexA(secondes: number): number {
    const cible = this.versTimescale(secondes);
    let vise = 0;
    for (const e of this.piste.echantillons) {
      if (e.pts <= cible) vise = e.index;
      else break;
    }
    return vise;
  }

  /**
   * Decode en avant et met en cache, pour que la lecture n ait plus a attendre.
   *
   * C est la difference entre « afficher une image » et « lire » : sans avance,
   * chaque image coute un aller-retour de decodage et la cadence s effondre.
   */
  precharger(secondes: number, nombreImages: number): Promise<void> {
    const suivante = this.file.then(
      () => this.precargerInterne(secondes, nombreImages),
      () => this.precargerInterne(secondes, nombreImages),
    );
    this.file = suivante.catch(() => undefined);
    return suivante;
  }

  private async precargerInterne(secondes: number, nombreImages: number): Promise<void> {
    if (!this.infos.decodable) return;
    const echantillons = this.piste.echantillons;
    if (echantillons.length === 0) return;

    const depart = this.indexA(secondes);
    const fin = Math.min(echantillons.length - 1, depart + nombreImages);
    // Tout est deja en cache : rien a faire, et surtout rien a decoder.
    let manquant = false;
    for (let i = depart; i <= fin; i += 1) {
      if (!this.cache.has(i)) {
        manquant = true;
        break;
      }
    }
    if (!manquant) return;

    await this.decoderPlage(imageCleAvant(this.piste, echantillons[depart]?.pts ?? 0), fin);
  }

  /**
   * Decode les echantillons de `depart` a `fin` et met TOUT en cache.
   * Les images intermediaires ne sont pas jetees : elles seront demandees juste
   * apres par la lecture.
   */
  private async decoderPlage(depart: number, fin: number): Promise<void> {
    let decodeur: VideoDecoder;
    try {
      decodeur = this.configurer();
    } catch {
      return;
    }

    const collecte: VideoFrame[] = [];
    this.collecte = collecte;
    try {
      for (let i = depart; i <= fin; i += 1) {
        const echantillon = this.piste.echantillons[i];
        if (echantillon === undefined) continue;
        const octets = await this.reader.lire(echantillon.offset, echantillon.taille);
        decodeur.decode(
          new EncodedVideoChunk({
            type: echantillon.cle ? 'key' : 'delta',
            timestamp: (echantillon.pts / this.piste.timescale) * 1_000_000,
            duration: (echantillon.duree / this.piste.timescale) * 1_000_000,
            data: octets,
          }),
        );
      }
      await decodeur.flush();
    } catch {
      this.collecte = null;
      for (const image of collecte) image.close();
      this.reinitialiser();
      return;
    }
    this.collecte = null;

    // On retrouve l index de chaque image par son horodatage : le decodeur
    // restitue en ordre d AFFICHAGE, pas dans l ordre ou on l a alimente.
    for (const image of collecte) {
      const index = this.indexParHorodatage(image.timestamp);
      if (index === null) image.close();
      else this.mettreEnCache(index, image);
    }
  }

  private indexParHorodatage(microsecondes: number): number | null {
    const pts = Math.round((microsecondes / 1_000_000) * this.piste.timescale);
    for (const e of this.piste.echantillons) {
      if (Math.abs(e.pts - pts) <= 1) return e.index;
    }
    return null;
  }

  fermer(): void {
    this.derniereImage?.close();
    this.derniereImage = null;
    this.viderCache();
    this.reinitialiser();
  }
}
