/**
 * Vignettes de timeline (section 18).
 *
 * Deux exigences de la section 18, et elles se contredisent en apparence :
 * « afficher des vignettes » et « ne jamais decoder les images inutilement ».
 * La resolution tient en trois regles :
 *
 *   1. le rendu Canvas est SYNCHRONE : il ne peut dessiner qu une vignette deja
 *      prete. Une vignette absente n est pas attendue, elle est demandee et le
 *      clip est dessine sans elle ;
 *   2. les demandes sont dedupliquees et limitees en nombre simultane, sinon
 *      une timeline dense lancerait des centaines de decodages ;
 *   3. rien n est demande pendant la LECTURE : le decodeur y est deja occupe a
 *      tenir la cadence, et lui voler du temps ferait sauter des images.
 *
 * Les vignettes sont converties en `ImageBitmap`, bien plus economes qu une
 * `VideoFrame` conservee vivante : la `VideoFrame` est fermee aussitot.
 */
import type { VideoSource } from './video-source.js';
export declare class CacheVignettes {
    private readonly capacite;
    private readonly surPret;
    private readonly images;
    private readonly enCours;
    private readonly echecs;
    private actives;
    private suspendu;
    constructor(capacite?: number, surPret?: () => void);
    /** Suspend les demandes, typiquement pendant la lecture. */
    suspendre(valeur: boolean): void;
    /**
     * Vignette prete, ou `null`. Dans ce second cas la demande est lancee, et
     * `surPret` sera appele quand elle aboutira.
     */
    obtenir(mediaId: string, source: VideoSource, secondes: number): ImageBitmap | null;
    private decoder;
    private ranger;
    /** Oublie ce qui concerne un media, par exemple apres sa suppression. */
    oublier(mediaId: string): void;
    etat(): {
        pretes: number;
        enCours: number;
        echecs: number;
    };
    vider(): void;
}
//# sourceMappingURL=thumbnails.d.ts.map