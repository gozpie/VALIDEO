/**
 * Decodage video par WebCodecs (sections 22, 901-1000).
 *
 * Chaine complete : fichier -> demultiplexeur -> `EncodedVideoChunk` ->
 * `VideoDecoder` -> `VideoFrame` -> canvas.
 *
 * PORTEE, dite clairement (section 1003). Ce module fournit l affichage d une
 * IMAGE FIXE a une position donnee -- ce qui suffit au scrub et aux moniteurs.
 * Ce n est PAS encore une lecture temps reel : il n y a ni file de decodage
 * anticipe, ni cache de textures GPU, ni synchronisation sur l horloge audio
 * pour l image. Ces trois pieces manquent, et le nom des choses le reflete.
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
    fermer(): void;
}
//# sourceMappingURL=video-source.d.ts.map