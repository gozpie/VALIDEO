/**
 * Jeu d icones maison (section 1, interdiction de reprendre des assets tiers).
 *
 * Des SVG en trait, dessines a la grille de 16 px, monochromes et pilotes par
 * `currentColor` : ils suivent donc l etat du bouton sans variante a maintenir.
 */
export interface ProprietesIcone {
    /** `| undefined` explicite : le projet active `exactOptionalPropertyTypes`,
        qui distingue « absent » de « présent et undefined ». */
    readonly taille?: number | undefined;
}
/** Ciblage de piste : une cible. */
export declare function IconeCible({ taille }: ProprietesIcone): React.JSX.Element;
/** Verrou. */
export declare function IconeVerrou({ taille }: ProprietesIcone): React.JSX.Element;
/** Visibilite de piste video : un œil. */
export declare function IconeOeil({ taille }: ProprietesIcone): React.JSX.Element;
/** Coupure du son : un haut-parleur barre. */
export declare function IconeMuet({ taille }: ProprietesIcone): React.JSX.Element;
/** Solo : un casque. */
export declare function IconeSolo({ taille }: ProprietesIcone): React.JSX.Element;
/** Verrouillage de synchronisation : deux maillons. */
export declare function IconeSync({ taille }: ProprietesIcone): React.JSX.Element;
//# sourceMappingURL=Icones.d.ts.map