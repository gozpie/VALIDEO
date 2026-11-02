import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION, SceneDocumentShape } from './scene';

/** JSON Schema (draft 2020-12) de la structure d'une scène. Les règles d'intégrité n'y figurent pas. */
export function buildJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(SceneDocumentShape, { target: 'draft-2020-12', unrepresentable: 'any' }),
    $id: `https://ai-scene-studio.local/schemas/scene.v${CURRENT_SCHEMA_VERSION}.schema.json`,
    title: `AI Scene Studio — Scene document v${CURRENT_SCHEMA_VERSION}`,
  };
}
