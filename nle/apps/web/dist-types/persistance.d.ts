import type { AppError } from '@valideo/shared';
import type { ProjectDoc } from '@valideo/project-model';
import type { EtatReprise, StorageProvider } from '@valideo/storage';
export interface ChoixStockage {
    readonly fournisseur: StorageProvider;
    /** Vrai si le travail survit a la fermeture de l onglet. */
    readonly persistant: boolean;
}
export declare function choisirStockage(): ChoixStockage;
export type EtatEnregistrement = 'propre' | 'modifie' | 'enregistrement' | 'erreur';
export interface Persistance {
    readonly etat: EtatEnregistrement;
    readonly persistant: boolean;
    readonly nomStockage: string;
    readonly reprise: EtatReprise;
    readonly erreur: AppError | null;
    readonly pret: boolean;
    enregistrer(doc: ProjectDoc): Promise<void>;
    accepterReprise(): void;
    refuserReprise(): void;
}
export interface OptionsPersistance {
    readonly document: ProjectDoc;
    readonly modifie: boolean;
    readonly surChargement: (doc: ProjectDoc) => void;
    readonly surEnregistrement: () => void;
    readonly delaiAutosaveMs?: number;
}
/**
 * Branche le document sur le stockage : chargement a l ouverture, detection
 * d une reprise, puis sauvegarde automatique temporisee.
 */
export declare function usePersistance(options: OptionsPersistance): Persistance;
//# sourceMappingURL=persistance.d.ts.map