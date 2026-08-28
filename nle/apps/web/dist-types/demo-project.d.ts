import type { ProjectDoc, SequenceDoc } from '@valideo/project-model';
/**
 * Identite STABLE du projet de demonstration.
 *
 * Sans identifiant fixe, chaque chargement de page creerait un projet different
 * et rien ne pourrait jamais etre retrouve dans le stockage : l enregistrement
 * ecrirait a une adresse neuve a chaque fois. Un vrai projet, lui, recevra son
 * identifiant a la creation et le conservera.
 */
export declare const ID_PROJET_DEMO: import("@valideo/shared").Brand<string, "ProjectId">;
export declare const ID_SEQUENCE_DEMO: import("@valideo/shared").Brand<string, "SequenceId">;
export declare function creerSequenceDemo(): SequenceDoc;
export declare function creerProjetDemo(): {
    projet: ProjectDoc;
    sequence: SequenceDoc;
};
//# sourceMappingURL=demo-project.d.ts.map