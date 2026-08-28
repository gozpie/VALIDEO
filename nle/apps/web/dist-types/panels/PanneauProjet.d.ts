/**
 * Panneau Projet (§7).
 *
 * Les colonnes affichees sont celles que le modele porte reellement. Les
 * colonnes de §7 qui dependent d une analyse media -- codec, resolution,
 * espace colorimetrique -- n apparaissent pas tant qu aucun media n est
 * importe : une colonne vide est plus honnete qu une colonne inventee.
 */
import type { SequenceDoc } from '@valideo/project-model';
export interface ProprietesPanneauProjet {
    readonly sequence: SequenceDoc;
    readonly timecode: (image: number) => string;
}
export declare function PanneauProjet({ sequence, timecode }: ProprietesPanneauProjet): React.JSX.Element;
//# sourceMappingURL=PanneauProjet.d.ts.map