import { describe, expect, it } from 'vitest';
import { createEmptyScene, validateScene, type SceneDocument } from '@ass/scene-schema';
import {
  copyKeys,
  evaluateScene,
  keyTransform,
  moveKeys,
  pasteKeys,
  removeKeys,
  setKey,
  setTransformAtFrame,
  trackFor,
} from '../src';

const CUBE = '00000000-0000-4000-8000-0000000000c1';
function scene(): SceneDocument {
  const doc = createEmptyScene({
    sceneId: '00000000-0000-4000-8000-0000000000c0',
    durationFrames: 100,
  });
  doc.nodes.push({
    id: CUBE,
    name: 'Cube',
    type: 'primitive',
    parentId: null,
    assetId: null,
    primitive: 'cube',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    visible: true,
    castShadow: true,
    receiveShadow: true,
    locked: false,
    layer: 'default',
    passIndex: 0,
    renderMode: 'final_3d',
    materialOverrides: [],
  });
  return doc;
}
const valid = (doc: SceneDocument) =>
  expect(validateScene(doc).success ? [] : validateScene(doc)).toEqual([]);
const position = (doc: SceneDocument, frame: number) =>
  evaluateScene(doc, frame).nodes[0]!.transform.position;

describe('édition des keyframes', () => {
  it('crée une piste, insère et remplace des clés triées', () => {
    let doc = setKey(scene(), {
      targetId: CUBE,
      propertyPath: 'transform.position',
      frame: 24,
      value: [2, 0, 0],
    });
    doc = setKey(doc, {
      targetId: CUBE,
      propertyPath: 'transform.position',
      frame: 0,
      value: [0, 0, 0],
    });
    doc = setKey(doc, {
      targetId: CUBE,
      propertyPath: 'transform.position',
      frame: 24,
      value: [4, 0, 0],
    });
    const track = trackFor(doc, CUBE, 'transform.position')!;
    expect(track.keyframes.map((k) => [k.frame, k.value])).toEqual([
      [0, [0, 0, 0]],
      [24, [4, 0, 0]],
    ]);
    expect(position(doc, 12)).toEqual([2, 0, 0]);
    valid(doc);
    expect(() =>
      setKey(doc, { targetId: CUBE, propertyPath: 'visible', frame: 1.5, value: true }),
    ).toThrow();
  });

  it('force step pour un booléen et refuse Bézier sur une rotation', () => {
    let doc = setKey(scene(), {
      targetId: CUBE,
      propertyPath: 'visible',
      frame: 0,
      value: true,
      interpolation: 'linear',
    });
    doc = setKey(doc, {
      targetId: CUBE,
      propertyPath: 'transform.rotation',
      frame: 0,
      value: [0, 0, 0, 1],
      interpolation: 'bezier',
    });
    expect(trackFor(doc, CUBE, 'visible')!.keyframes[0]!.interpolation).toBe('step');
    expect(trackFor(doc, CUBE, 'transform.rotation')!.keyframes[0]!.interpolation).toBe('linear');
    valid(doc);
  });

  it('déplace, supprime, copie et colle des clés', () => {
    let doc = keyTransform(
      scene(),
      CUBE,
      { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      0,
    );
    doc = keyTransform(
      doc,
      CUBE,
      { position: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      10,
    );
    const pos = trackFor(doc, CUBE, 'transform.position')!;
    doc = moveKeys(doc, [{ trackId: pos.id, frame: 10 }], 10);
    expect(position(doc, 10)).toEqual([5, 0, 0]);
    expect(() => moveKeys(doc, [{ trackId: pos.id, frame: 20 }], -20)).toThrow(/même frame/);
    expect(() => moveKeys(doc, [{ trackId: pos.id, frame: 0 }], -1)).toThrow(/frame 0/);

    const clipboard = copyKeys(doc, [
      { trackId: pos.id, frame: 0 },
      { trackId: pos.id, frame: 20 },
    ]);
    expect(clipboard.map((e) => e.offset)).toEqual([0, 20]);
    doc = pasteKeys(doc, clipboard, 50);
    expect(trackFor(doc, CUBE, 'transform.position')!.keyframes.map((k) => k.frame)).toEqual([
      0, 20, 50, 70,
    ]);

    doc = removeKeys(
      doc,
      trackFor(doc, CUBE, 'transform.scale')!.keyframes.map((k) => ({
        trackId: trackFor(doc, CUBE, 'transform.scale')!.id,
        frame: k.frame,
      })),
    );
    expect(trackFor(doc, CUBE, 'transform.scale')).toBeUndefined();
    valid(doc);
  });

  it('une modification à une frame clé les propriétés animées et modifie la base des autres', () => {
    let doc = setKey(scene(), {
      targetId: CUBE,
      propertyPath: 'transform.position',
      frame: 0,
      value: [0, 0, 0],
    });
    doc = setKey(doc, {
      targetId: CUBE,
      propertyPath: 'transform.position',
      frame: 20,
      value: [2, 0, 0],
    });
    doc = setTransformAtFrame(
      doc,
      CUBE,
      { position: [9, 9, 9], rotation: [0, 0, 0, 1], scale: [3, 3, 3] },
      10,
    );
    expect(trackFor(doc, CUBE, 'transform.position')!.keyframes.map((k) => k.frame)).toEqual([
      0, 10, 20,
    ]);
    expect(position(doc, 10)).toEqual([9, 9, 9]);
    expect(doc.nodes[0]!.transform.scale).toEqual([3, 3, 3]);
    expect(trackFor(doc, CUBE, 'transform.scale')).toBeUndefined();
    valid(doc);
  });
});
