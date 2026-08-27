/**
 * Identifiants types (branded types).
 *
 * Un `ClipId` et un `TrackId` sont tous deux des chaines a l execution, mais le
 * compilateur refuse de les confondre. Dans un moteur ou l on manipule en
 * permanence des identifiants de clip, de piste, de media et d effet, c est la
 * protection la moins chere contre une classe entiere de bugs silencieux.
 *
 * Les identifiants sont des UUID v4 (section 901-1000 : identifiants UUID pour
 * le format de projet, afin que deux projets fusionnes n entrent pas en
 * collision).
 */

import { randomUuid } from './platform.js';

declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ProjectId = Brand<string, 'ProjectId'>;
export type SequenceId = Brand<string, 'SequenceId'>;
export type TrackId = Brand<string, 'TrackId'>;
export type ClipId = Brand<string, 'ClipId'>;
export type MediaId = Brand<string, 'MediaId'>;
export type BinId = Brand<string, 'BinId'>;
export type MarkerId = Brand<string, 'MarkerId'>;
export type EffectId = Brand<string, 'EffectId'>;
export type KeyframeId = Brand<string, 'KeyframeId'>;
export type TransitionId = Brand<string, 'TransitionId'>;
export type LinkGroupId = Brand<string, 'LinkGroupId'>;
export type CommandId = Brand<string, 'CommandId'>;

/** Genere un UUID v4. */
export function uuid(): string {
  return randomUuid();
}

function makeFactory<T extends string>(): {
  (): Brand<string, T>;
  of: (raw: string) => Brand<string, T>;
} {
  const factory = (): Brand<string, T> => uuid() as Brand<string, T>;
  factory.of = (raw: string): Brand<string, T> => raw as Brand<string, T>;
  return factory;
}

/** `newProjectId()` genere ; `newProjectId.of(raw)` requalifie une chaine lue sur disque. */
export const newProjectId = makeFactory<'ProjectId'>();
export const newSequenceId = makeFactory<'SequenceId'>();
export const newTrackId = makeFactory<'TrackId'>();
export const newClipId = makeFactory<'ClipId'>();
export const newMediaId = makeFactory<'MediaId'>();
export const newBinId = makeFactory<'BinId'>();
export const newMarkerId = makeFactory<'MarkerId'>();
export const newEffectId = makeFactory<'EffectId'>();
export const newKeyframeId = makeFactory<'KeyframeId'>();
export const newTransitionId = makeFactory<'TransitionId'>();
export const newLinkGroupId = makeFactory<'LinkGroupId'>();
export const newCommandId = makeFactory<'CommandId'>();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
