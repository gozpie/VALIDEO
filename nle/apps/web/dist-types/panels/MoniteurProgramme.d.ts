import type { SequenceDoc } from '@valideo/project-model';
import type { VideoSource } from '../media/video-source.js';
export interface ProprietesMoniteurProgramme {
    readonly sequence: SequenceDoc;
    readonly tete: number;
    readonly tempsCode: string;
    readonly duree: string;
    readonly sources: ReadonlyMap<string, VideoSource>;
    readonly mediaCadence: (mediaId: string) => number;
    readonly enLecture: boolean;
}
export declare function MoniteurProgramme({ sequence, tete, tempsCode, duree, sources, mediaCadence, enLecture, }: ProprietesMoniteurProgramme): React.JSX.Element;
//# sourceMappingURL=MoniteurProgramme.d.ts.map