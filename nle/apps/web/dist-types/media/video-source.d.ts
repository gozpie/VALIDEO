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
import type { FichierMp4, PisteMp4, RangeReader } from '@valideo/demux';
/** Lecteur par plage sur un `File` : `Blob.slice` ne charge que la tranche demandee. */
export declare class FileRangeReader implements RangeReader {
    private readonly fichier;
    constructor(fichier: File);
    get taille(): number;
    lire(offset: number, longueur: number): Promise<Uint8Array>;
}
export interface InfosVideo {
    readonly codec: string;
    readonly largeur: number;
    readonly hauteur: number;
    /** Cadence deduite de la duree mediane des echantillons, en fraction exacte. */
    readonly cadence: {
        n: number;
        d: number;
    };
    readonly nombreImages: number;
    readonly timescale: number;
    readonly decodable: boolean;
}
/**
 * Cadence exacte, deduite de la timescale et de la duree d image.
 *
 * C est bien plus fiable que ce qu expose un element video : 12800/512 donne
 * exactement 25, et 24000/1001 reste 24000/1001 au lieu de devenir 23,976.
 */
export declare function cadenceExacte(piste: PisteMp4): {
    n: number;
    d: number;
};
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
export declare class VideoSource {
    private readonly reader;
    readonly fichier: FichierMp4;
    readonly piste: PisteMp4;
    readonly infos: InfosVideo;
    private decodeur;
    /** Images emises par le decodeur pendant la demande en cours. */
    private collecte;
    /** Cache d images decodees, par index d echantillon. `Map` conserve l ordre. */
    private readonly cache;
    private pixelsEnCache;
    /** Budget du cache, en pixels. 64 Mpx : environ 250 Mo en RGBA. */
    private budgetPixels;
    private derniereImage;
    private derniereCle;
    /**
     * File d attente d une seule voie.
     *
     * Un `VideoDecoder` a un ETAT : la position atteinte dans le groupe d images.
     * Deux appels concurrents a `imageA` se marcheraient dessus et rendraient des
     * images fausses, ou aucune. On serialise donc les demandes.
     */
    private file;
    private constructor();
    static ouvrir(fichier: File): Promise<Result<OuvertureVideo, AppError>>;
    private configurer;
    private reinitialiser;
    /** Convertit un instant en secondes vers les unites de la piste. */
    private versTimescale;
    /**
     * Image affichable a l instant demande.
     *
     * Les demandes sont SERIALISEES : un decodeur porte un etat -- la position
     * atteinte dans le groupe d images -- que deux appels concurrents
     * corrompraient.
     */
    imageA(secondes: number): Promise<VideoFrame | null>;
    /**
     * On repart de l image cle qui precede la cible, puis on decode en avant :
     * c est la seule facon correcte de decoder un format inter-images.
     */
    private decoderImage;
    /** Ajuste le budget du cache selon le profil de la machine (section 58). */
    definirBudgetPixels(pixels: number): void;
    private coutImage;
    private mettreEnCache;
    /** Evince les plus anciennes jusqu a rentrer dans le budget. */
    private elaguer;
    private viderCache;
    /** Etat du cache, pour le panneau de performance (section 104). */
    etatCache(): {
        images: number;
        pixels: number;
        budget: number;
    };
    /** Index d echantillon correspondant a un instant. */
    private indexA;
    /**
     * Decode en avant et met en cache, pour que la lecture n ait plus a attendre.
     *
     * C est la difference entre « afficher une image » et « lire » : sans avance,
     * chaque image coute un aller-retour de decodage et la cadence s effondre.
     */
    precharger(secondes: number, nombreImages: number): Promise<void>;
    private precargerInterne;
    /**
     * Decode les echantillons de `depart` a `fin` et met TOUT en cache.
     * Les images intermediaires ne sont pas jetees : elles seront demandees juste
     * apres par la lecture.
     */
    private decoderPlage;
    private indexParHorodatage;
    fermer(): void;
}
//# sourceMappingURL=video-source.d.ts.map