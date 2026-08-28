/**
 * Rendu Canvas de la timeline (sections 2, 17, 18, 55).
 *
 * Aucune dependance a React. Cette fonction est appelee directement depuis une
 * boucle d animation pendant un geste, donc SANS provoquer le moindre rendu
 * React (section 2). Elle ne fait que lire un modele deja calcule par
 * `@valideo/timeline-engine`.
 *
 * Les formes d onde dessinees ici proviennent de VRAIS echantillons decodes par
 * le navigateur. Un clip dont le media n a pas ete decode n en recoit aucune :
 * il vaut mieux un fond uni qu une courbe inventee (section 1003). Les vignettes
 * video restent absentes pour la meme raison, tant qu il n y a pas de decodeur.
 */
import type { SequenceDoc } from '@valideo/project-model';
import type { TimeBase } from '@valideo/time-core';
import type { RenderModel, Viewport } from '@valideo/timeline-engine';
import type { WaveformColumn } from '@valideo/audio-engine';
export declare const HAUTEUR_REGLE = 24;
export declare const PALETTE: {
    readonly fond: "#1e1e21";
    readonly fondRegle: "#26262a";
    readonly fondPisteVide: "#1a1a1d";
    readonly bord: "#333338";
    readonly bordFort: "#45454d";
    readonly texte: "#d6d6da";
    readonly texteDoux: "#8e8e96";
    readonly texteFort: "#f2f2f4";
    readonly grille: "#2a2a2f";
    readonly clipVideo: "#3d4f6b";
    readonly clipVideoBord: "#5c7aa8";
    readonly clipAudio: "#3d5f4a";
    readonly clipAudioBord: "#5c9070";
    readonly clipTitre: "#6b4f3d";
    readonly clipTitreBord: "#a87c5c";
    readonly clipCalque: "#4a3d6b";
    readonly clipCalqueBord: "#7d5ca8";
    readonly clipDesactive: "#2b2b30";
    readonly selection: "#f0a800";
    readonly tete: "#e05a52";
    readonly accroche: "#4c8dff";
    readonly marqueur: "#e0a63a";
};
export interface CoulJeu {
    readonly fond: string;
    readonly bord: string;
}
export interface ApercuGeste {
    /** Clips deplaces, dessines en surimpression a leur position provisoire. */
    readonly clipIds: ReadonlySet<string>;
    readonly decalageX: number;
    readonly decalageY: number;
    /** Position d accrochage a materialiser, en images. */
    readonly accroche: number | null;
    /** Rectangle de selection en cours. */
    readonly rectangle: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    } | null;
}
/**
 * Fournit les colonnes de forme d onde d un clip, ou `null` si son media n a pas
 * ete decode. La fonction est appelee pendant le dessin : elle doit se contenter
 * de lire la pyramide de pics deja construite (section 19).
 */
export type FournisseurFormeOnde = (clip: RenderModel['clips'][number], colonnes: number) => readonly WaveformColumn[] | null;
export interface OptionsRendu {
    readonly sequence: SequenceDoc;
    readonly modele: RenderModel;
    readonly viewport: Viewport;
    readonly largeur: number;
    readonly hauteur: number;
    readonly tete: number;
    readonly graduations: readonly number[];
    readonly base: TimeBase;
    readonly debutTimecode: number;
    readonly geste: ApercuGeste | null;
    readonly dpr: number;
    readonly formeOnde?: FournisseurFormeOnde | undefined;
}
export declare function timebaseDeSequence(sequence: SequenceDoc): TimeBase;
/** Dessine tout. Appelee a chaque image pendant un geste. */
export declare function dessinerTimeline(ctx: CanvasRenderingContext2D, o: OptionsRendu): void;
//# sourceMappingURL=draw.d.ts.map