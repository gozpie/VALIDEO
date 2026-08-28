import type { ActionsEditeur, EtatEditeur } from '../store.js';
export interface ProprietesMedias {
    readonly etat: EtatEditeur;
    readonly actions: ActionsEditeur;
    readonly timecode: (image: number) => string;
}
export declare function PanneauMedias({ etat, actions, timecode }: ProprietesMedias): React.JSX.Element;
//# sourceMappingURL=PanneauMedias.d.ts.map