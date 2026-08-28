/**
 * Moniteur Source et Moniteur Programme.
 *
 * Volontairement VIDES (section 1003). Le moteur de lecture n existe pas encore :
 * afficher une mire, une image fixe ou des boutons de transport qui ne
 * transportent rien serait exactement le « faire semblant » que le cahier des
 * charges interdit. Le panneau dit ce qui manque et pourquoi.
 */
export interface ProprietesMoniteur {
    readonly titre: string;
    readonly tete?: string;
    readonly duree?: string;
}
export declare function Moniteur({ titre, tete, duree }: ProprietesMoniteur): React.JSX.Element;
//# sourceMappingURL=Moniteur.d.ts.map