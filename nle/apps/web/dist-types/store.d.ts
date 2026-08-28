import type { Command } from '@valideo/command-system';
import type { AppError } from '@valideo/shared';
import type { SequenceDoc } from '@valideo/project-model';
import type { TimelineContext } from '@valideo/timeline-model';
export type Outil = 'selection' | 'trackSelect' | 'ripple' | 'rolling' | 'razor' | 'slip' | 'slide' | 'rateStretch' | 'hand';
export interface EtatEditeur {
    readonly sequence: SequenceDoc;
    readonly selection: ReadonlySet<string>;
    readonly tete: number;
    readonly outil: Outil;
    readonly accrochage: boolean;
    readonly historique: {
        canUndo: boolean;
        canRedo: boolean;
        labels: readonly string[];
        position: number;
        dirty: boolean;
    };
    readonly derniereErreur: AppError | null;
    readonly contexte: TimelineContext;
}
export interface ActionsEditeur {
    executer(commande: Command<SequenceDoc>): boolean;
    annuler(): void;
    retablir(): void;
    allerA(index: number): void;
    enregistrer(): void;
    definirSelection(ids: Iterable<string>): void;
    basculerSelection(id: string, additive: boolean): void;
    definirTete(image: number): void;
    definirOutil(outil: Outil): void;
    basculerAccrochage(): void;
    effacerErreur(): void;
}
export declare function useEditeur(): [EtatEditeur, ActionsEditeur];
/** Cadence de la séquence, en flottant, pour l affichage seul. */
export declare function cadenceAffichee(sequence: SequenceDoc): number;
export declare const UNE: import("@valideo/time-core").Rational;
//# sourceMappingURL=store.d.ts.map