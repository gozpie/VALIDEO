/**
 * Moniteur Source et Moniteur Programme.
 *
 * L IMAGE reste volontairement absente (section 1003) : il n y a ni
 * demultiplexeur ni decodeur video, et afficher une mire ou une image fixe
 * serait exactement le « faire semblant » qu interdit le cahier des charges.
 *
 * Le SON, lui, est reellement decode et joue, et c est l horloge audio qui
 * commande la tete de lecture (section 22). Le panneau distingue donc
 * clairement les deux plutot que de tout declarer indisponible.
 */
export interface ProprietesMoniteur {
    readonly titre: string;
    readonly tete?: string | undefined;
    readonly duree?: string | undefined;
    readonly enLecture?: boolean | undefined;
}
export declare function Moniteur({ titre, tete, duree, enLecture, }: ProprietesMoniteur): React.JSX.Element;
//# sourceMappingURL=Moniteur.d.ts.map