import type { ActionsEditeur, EtatEditeur } from '../store.js';
export interface ProprietesInfo {
    readonly etat: EtatEditeur;
    readonly actions: ActionsEditeur;
    readonly timecode: (image: number) => string;
    readonly duree: number;
}
export declare function PanneauInfo({ etat, actions, timecode, duree }: ProprietesInfo): React.JSX.Element;
//# sourceMappingURL=PanneauInfo.d.ts.map