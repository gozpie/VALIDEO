/**
 * Import de medias reels dans le navigateur (sections 8, 9, 19, 84).
 *
 * Ce que le navigateur permet REELLEMENT, sans serveur :
 *
 *   audio -- `decodeAudioData` decode integralement le fichier. On obtient de
 *            vrais echantillons, donc une vraie pyramide de pics, donc une
 *            vraie forme d onde. Rien n est simule.
 *
 *   video -- on lit les metadonnees (duree, definition) via un element video, et
 *            on interroge WebCodecs sur la decodabilite du codec. On ne demuxe
 *            PAS : cela demande un demultiplexeur que le projet n a pas encore.
 *            Le media est donc importe avec ses vraies caracteristiques, et
 *            marque comme non lisible tant que le moteur de lecture n existe
 *            pas (section 1003).
 *
 * Les caracteristiques fines exigees par la section 9 -- profil, niveau, format
 * de pixel, colorimetrie, timecode embarque -- ne sont pas accessibles au
 * navigateur seul. Elles viendront du service d analyse ffprobe deja ecrit et
 * teste (`apps/media-worker`). Les champs correspondants restent donc vides
 * plutot que d etre devines.
 */
import type { MediaAssetDoc } from '@valideo/project-model';
import type { PeakPyramid } from '@valideo/audio-engine';
export interface MediaImporte {
    readonly asset: MediaAssetDoc;
    /** Pyramide de pics, uniquement pour les fichiers dont l audio a ete decode. */
    readonly pics: PeakPyramid | null;
    /**
     * Tampon audio decode, conserve pour la lecture.
     *
     * `null` au-dela du budget memoire : une heure de stereo a 48 kHz occupe
     * 1,4 Go en flottants 32 bits. On garde alors la pyramide de pics -- qui
     * suffit a l affichage et ne coute que quelques mega-octets -- et on signale
     * que la lecture demandera un decodage a la demande.
     */
    readonly tampon: AudioBuffer | null;
    /** Ce qui n a pas pu etre determine, a signaler sans dramatiser. */
    readonly avertissements: readonly string[];
}
/** Budget memoire pour un tampon decode. Au-dela, on ne le conserve pas. */
export declare const BUDGET_TAMPON_OCTETS: number;
export declare function tailleDecodee(tampon: AudioBuffer): number;
export declare function extensionDe(nom: string): string;
export type FamilleMedia = 'audio' | 'video' | 'image' | 'inconnu';
export declare function familleDe(fichier: {
    name: string;
    type: string;
}): FamilleMedia;
export interface OptionsImport {
    /** Cadence attribuee aux medias dont on ne peut pas la mesurer. */
    readonly cadenceParDefaut?: {
        n: number;
        d: number;
    };
    readonly contexteAudio?: BaseAudioContext;
}
/**
 * Importe un fichier. Ne leve jamais : un fichier illisible revient avec un
 * avertissement et un media marque hors ligne, ce que l interface sait afficher.
 */
export declare function importerFichier(fichier: File, options?: OptionsImport): Promise<MediaImporte>;
/** Cadence deduite d une valeur flottante lue ailleurs, ramenee a une fraction. */
export declare function cadenceDepuisFlottant(valeur: number): {
    n: number;
    d: number;
};
export declare const CADENCE_PAR_DEFAUT: {
    n: number;
    d: number;
};
//# sourceMappingURL=import.d.ts.map