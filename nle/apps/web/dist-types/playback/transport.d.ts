/**
 * Transport audio : l horloge audio est MAITRE (section 22).
 *
 * Principe, et c est le point qui compte : la position de lecture n est jamais
 * incrementee a la main. Elle est DERIVEE de `AudioContext.currentTime`, la
 * seule horloge qui avance au rythme reel de la carte son. Tout le reste --
 * tete de lecture, moniteurs, futur decodage video -- se synchronise dessus.
 *
 * Incrementer une position dans une boucle d animation donnerait une derive
 * immediate : `requestAnimationFrame` suit l ecran, pas le son, et les deux
 * horloges ne sont jamais exactement au meme rythme.
 *
 * Programmation par fenetre glissante : on ne programme pas toute la sequence
 * d un coup -- ce serait des milliers de nœuds pour une heure de montage --
 * mais quelques secondes d avance, reapprovisionnees regulierement.
 */
import type { SequenceDoc } from '@valideo/project-model';
import type { SegmentIgnore } from '@valideo/playback';
import type { Rational } from '@valideo/time-core';
export interface OptionsTransport {
    /** Tampon decode d un media, ou `null` s il n est pas disponible. */
    readonly tampon: (mediaId: string) => AudioBuffer | null;
    readonly cadenceSource: (mediaId: string) => Rational | null;
    /** Appele quand la lecture s arrete d elle-meme, en fin de sequence. */
    readonly surFin?: () => void;
}
export interface EtatTransport {
    readonly enLecture: boolean;
    /** Position courante, en images de sequence. */
    readonly position: number;
    /** Clips que le moteur n a pas su jouer, avec la raison. */
    readonly ignores: readonly SegmentIgnore[];
    /** Vrai si le contexte audio existe et tourne. */
    readonly audioDisponible: boolean;
}
export declare class TransportAudio {
    private readonly options;
    private ctx;
    private sortie;
    private sources;
    private minuterie;
    private sequence;
    private cadence;
    private imageDepart;
    private ctxDepart;
    private programmeJusqua;
    private finSequence;
    private ignores;
    private lecture;
    constructor(options: OptionsTransport);
    private contexte;
    /** Position courante, DERIVEE de l horloge audio. */
    position(): number;
    enLecture(): boolean;
    etat(): EtatTransport;
    demarrer(sequence: SequenceDoc, depuisImage: number, finSequence: number): Promise<void>;
    arreter(): void;
    /** Programme la tranche suivante, si elle n est pas deja couverte. */
    private approvisionner;
    private programmerSegment;
    /** Repositionne la tete sans lancer la lecture. */
    placer(image: number): void;
    fermer(): Promise<void>;
}
//# sourceMappingURL=transport.d.ts.map