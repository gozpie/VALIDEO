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
 *   LECTURE -- `precharger` alimente le decodeur EN CONTINU et chaque image entre
 *              dans un cache borne des qu elle sort. `imagePrete` la sert alors
 *              sans decoder, ce qui rend possible une lecture a la cadence de la
 *              sequence.
 *
 * Le cache est borne en PIXELS et non en nombre d images : vingt-quatre images
 * de 320x240 coutent 7 Mo, les memes en 4K en couteraient 800 (section 57).
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok } from '@valideo/shared';
import type { EchantillonMp4, FichierMp4, PisteMp4, RangeReader } from '@valideo/demux';
import { demultiplexerMp4, imageCleAvant, premierePiste } from '@valideo/demux';
import { dernierADecoder, ordreAffichage, rangAuPlusTard } from './ordre-affichage';

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

/** Ce que le moniteur et les vignettes attendent d'une source d'images. */
export type SourceVisuelle = Pick<VideoSource, 'infos' | 'precharger' | 'imagePrete' | 'fermer'> & {
  imageA(secondes: number): Promise<VideoFrame | null>;
};

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
/** Images qu'un décodeur H.264 peut garder pour lui avant de les rendre (réordonnancement). */
const IMAGES_RETENUES_PAR_LE_DECODEUR = 16;
/** Au-delà, on attend le décodeur : inutile de lire le fichier plus vite qu'il ne décode. */
const FILE_DECODEUR_MAX = 6;

export class VideoSource {
  private decodeur: VideoDecoder | null = null;
  /** Images emises par le decodeur pendant la demande en cours. */
  private collecte: VideoFrame[] | null = null;
  /** Cache d images decodees, par index d echantillon. `Map` conserve l ordre. */
  private readonly cache = new Map<number, VideoFrame>();
  private pixelsEnCache = 0;
  /** Budget du cache, en pixels. 64 Mpx : environ 250 Mo en RGBA. */
  private budgetPixels = 64_000_000;
  private derniereCle = -1;
  /** Image que la lecture demande en ce moment : ce qui est derrière s'évince en premier. */
  private positionLecture = 0;
  private enPrechargement = false;
  /**
   * Prochain echantillon a donner au decodeur en lecture continue, ou `null` si le decodeur ne suit
   * pas de flux. Tant qu un flux tourne, chaque image va au cache des qu elle sort.
   */
  private fluxProchain: number | null = null;
  private fluxUtileDepuis = 0;
  /**
   * File d attente d une seule voie.
   *
   * Un `VideoDecoder` a un ETAT : la position atteinte dans le groupe d images.
   * Deux appels concurrents a `imageA` se marcheraient dessus et rendraient des
   * images fausses, ou aucune. On serialise donc les demandes.
   */
  private file: Promise<unknown> = Promise.resolve();

  /** Échantillons dans l'ordre d'affichage. Le cache et les positions sont en rangs de cet ordre. */
  private readonly ordre: readonly EchantillonMp4[];
  /** Image manquante au dernier tour, et depuis combien de tours elle l'est. */
  private attendue = { rang: -1, tours: 0 };

  private constructor(
    private readonly reader: RangeReader,
    readonly fichier: FichierMp4,
    readonly piste: PisteMp4,
    readonly infos: InfosVideo,
  ) {
    this.ordre = ordreAffichage(piste.echantillons);
  }

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
        if (collecte !== null) {
          collecte.push(image);
          return;
        }
        const index = this.fluxProchain === null ? null : this.indexParHorodatage(image.timestamp);
        if (index === null || index < this.fluxUtileDepuis) image.close();
        else this.mettreEnCache(index, image);
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
    this.fluxProchain = null;
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
  /** Image deja decodee a cet instant, sans rien lancer : c est tout ce que la lecture peut se permettre. */
  imagePrete(secondes: number): VideoFrame | null {
    if (!this.infos.decodable) return null;
    return this.cache.get(this.indexA(secondes))?.clone() ?? null;
  }

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

    // Le préchargement qui précédait dans la file a pu décoder cette image entre-temps.
    const dejaLa = this.cache.get(this.indexA(secondes));
    if (dejaLa !== undefined) return dejaLa.clone();

    const cible = this.versTimescale(secondes);

    // Echantillon a afficher : le dernier dont le pts ne depasse pas la cible.
    const vise = this.ordre[rangAuPlusTard(this.ordre, cible)]?.index ?? 0;

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
    this.fluxProchain = null;
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

  /** Evince d abord ce que la lecture a depasse, puis les plus anciennes, jusqu a rentrer dans le budget. */
  private elaguer(): void {
    for (const derriereSeulement of [true, false]) {
      for (const [index, image] of this.cache) {
        if (this.pixelsEnCache <= this.budgetPixels) return;
        if (derriereSeulement && index >= this.positionLecture) continue;
        this.pixelsEnCache -= this.coutImage(image);
        image.close();
        this.cache.delete(index);
      }
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

  /** Rang d affichage de l image a montrer a cet instant. */
  private indexA(secondes: number): number {
    return rangAuPlusTard(this.ordre, this.versTimescale(secondes));
  }

  /**
   * Decode en avant et met en cache, pour que la lecture n ait plus a attendre.
   *
   * C est la difference entre « afficher une image » et « lire » : sans avance,
   * chaque image coute un aller-retour de decodage et la cadence s effondre.
   */
  precharger(secondes: number, nombreImages: number): Promise<void> {
    // Un préchargement est déjà en route : en empiler d'autres ne ferait que retarder l'affichage.
    if (this.enPrechargement) return Promise.resolve();
    this.enPrechargement = true;
    const lancer = (): Promise<void> =>
      this.precargerInterne(secondes, nombreImages).finally(() => {
        this.enPrechargement = false;
      });
    const suivante = this.file.then(lancer, lancer);
    this.file = suivante.catch(() => undefined);
    return suivante;
  }

  private async precargerInterne(secondes: number, nombreImages: number): Promise<void> {
    if (!this.infos.decodable) return;
    const echantillons = this.piste.echantillons;
    if (echantillons.length === 0) return;

    const depart = this.indexA(secondes);
    this.positionLecture = depart;
    // Jamais plus que ce que le cache peut tenir : au-delà, il évincerait ce qu'on vient de décoder,
    // et tout serait à refaire au tour suivant.
    const pixelsImage = Math.max(1, this.infos.largeur * this.infos.hauteur);
    const capacite = Math.max(2, Math.floor((this.budgetPixels * 0.8) / pixelsImage));
    const fin = Math.min(this.ordre.length - 1, depart + Math.min(nombreImages, capacite));
    // On reprend à la première image manquante : tout est en cache, rien à décoder.
    let manquante: number | null = null;
    for (let rang = depart; rang <= fin; rang += 1) {
      if (!this.cache.has(rang)) {
        manquante = rang;
        break;
      }
    }
    if (manquante === null) return;
    this.attendue =
      this.attendue.rang === manquante
        ? { rang: manquante, tours: this.attendue.tours + 1 }
        : { rang: manquante, tours: 0 };

    const echantillon = this.ordre[manquante];
    if (echantillon === undefined) return;
    const dernier = dernierADecoder(this.ordre, depart, fin);

    // Le flux en cours arrive à cette image (le décodeur en garde quelques-unes pour lui) : on continue.
    // Sinon, ou si elle n'arrive décidément pas, on repart de l'image clé qui la précède.
    const flux = this.fluxProchain;
    if (
      flux !== null &&
      echantillon.index >= flux - IMAGES_RETENUES_PAR_LE_DECODEUR &&
      manquante >= this.fluxUtileDepuis &&
      this.attendue.tours < 3
    ) {
      await this.alimenterFlux(flux, dernier);
      return;
    }
    this.reinitialiser();
    this.fluxUtileDepuis = manquante;
    this.attendue = { rang: manquante, tours: 0 };
    await this.alimenterFlux(imageCleAvant(this.piste, echantillon.pts), dernier);
  }

  /**
   * Donne au decodeur les echantillons de `depart` a `fin`, sans le vider : un `flush` a chaque tour
   * obligerait a repartir d une image cle, et rien ne sortirait avant la fin de la tranche. Il n est
   * vide qu a la fin du fichier, ou il retiendrait sinon ses dernieres images.
   */
  private async alimenterFlux(depart: number, fin: number): Promise<void> {
    let decodeur: VideoDecoder;
    try {
      decodeur = this.configurer();
    } catch {
      return;
    }
    const echantillons = this.piste.echantillons;
    try {
      for (let i = depart; i <= fin; i += 1) {
        const echantillon = echantillons[i];
        if (echantillon === undefined) continue;
        const octets = await this.reader.lire(echantillon.offset, echantillon.taille);
        if (decodeur.state !== 'configured') return;
        this.fluxProchain = i + 1;
        decodeur.decode(
          new EncodedVideoChunk({
            type: echantillon.cle ? 'key' : 'delta',
            timestamp: (echantillon.pts / this.piste.timescale) * 1_000_000,
            duration: (echantillon.duree / this.piste.timescale) * 1_000_000,
            data: octets,
          }),
        );
        while (decodeur.decodeQueueSize > FILE_DECODEUR_MAX) {
          await new Promise((fait) => {
            decodeur.addEventListener('dequeue', fait, { once: true });
          });
        }
      }
      if (fin === echantillons.length - 1) {
        await decodeur.flush();
        this.fluxProchain = null;
      }
    } catch {
      this.reinitialiser();
    }
  }

  private indexParHorodatage(microsecondes: number): number | null {
    const pts = Math.round((microsecondes / 1_000_000) * this.piste.timescale);
    const rang = rangAuPlusTard(this.ordre, pts + 1);
    const echantillon = this.ordre[rang];
    return echantillon !== undefined && Math.abs(echantillon.pts - pts) <= 1 ? rang : null;
  }

  fermer(): void {
    this.viderCache();
    this.reinitialiser();
  }
}
