import type { FrameRate } from './primitives';
import { CURRENT_SCHEMA_VERSION, type SceneDocument } from './scene';

export interface CreateEmptySceneOptions {
  sceneId: string;
  fps?: FrameRate;
  durationFrames?: number;
  width?: number;
  height?: number;
}

/** Crée une scène vide et valide, prête à être éditée. */
export function createEmptyScene(options: CreateEmptySceneOptions): SceneDocument {
  const durationFrames = options.durationFrames ?? 120;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sceneId: options.sceneId,
    coordinateSystem: { handedness: 'right', upAxis: '+Y', forwardAxis: '-Z' },
    units: { length: 'meter', angle: 'radian' },
    fps: options.fps ?? { numerator: 24, denominator: 1 },
    durationFrames,
    nodes: [],
    cameras: [],
    lights: [],
    materials: [],
    animations: [],
    references: [],
    renderSettings: {
      width: options.width ?? 1920,
      height: options.height ?? 1080,
      frameStart: 0,
      frameEnd: durationFrames - 1,
      samples: 64,
      transparentBackground: false,
      motionBlur: false,
      antiAliasing: 'msaa4',
      colorManagement: { workingSpace: 'linear_rec709', displayTransform: 'srgb' },
    },
  };
}
