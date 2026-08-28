import { fit, snapFrame } from '@valideo/timeline-engine';
import type { Viewport } from '@valideo/timeline-engine';
import type { ActionsEditeur, EtatEditeur } from '../store.js';
export interface ProprietesTimeline {
    readonly etat: EtatEditeur;
    readonly actions: ActionsEditeur;
    readonly vue: Viewport;
    readonly definirVue: (v: Viewport | ((v: Viewport) => Viewport)) => void;
    readonly defilementVertical: number;
    readonly definirDefilementVertical: (v: number) => void;
}
export declare function Timeline({ etat, actions, vue, definirVue, defilementVertical, definirDefilementVertical, }: ProprietesTimeline): React.JSX.Element;
export { fit as ajusterVue, snapFrame as accrocherImage };
//# sourceMappingURL=Timeline.d.ts.map