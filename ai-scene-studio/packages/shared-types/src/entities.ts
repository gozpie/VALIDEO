/**
 * Contrats des entités persistées, tels qu'exposés par l'API (JSON, dates ISO 8601 UTC).
 * Les identifiants sont des UUID stables. Le backend (Pydantic/SQLAlchemy) est la référence :
 * les entités déjà servies par l'API sont réexportées depuis `@ass/api-client` (types générés).
 */
export type Uuid = string;
export type IsoDateTime = string;

// Entités de la phase 1 : générées depuis le contrat OpenAPI de l'API (source unique).
export type {
  ColorSpace,
  Fps,
  Member as WorkspaceMember,
  Project,
  Resolution,
  SceneRevision,
  SceneState,
  Sequence,
  Shot,
  User,
  Workspace,
  WorkspaceRole,
} from '@ass/api-client';

// Entités des phases suivantes : forme cible, remplacée par les types générés à leur implémentation.
export type AssetType =
  'model' | 'texture' | 'hdri' | 'image' | 'video' | 'reference' | 'render' | 'render_pass';

export interface Asset {
  id: Uuid;
  workspaceId: Uuid;
  type: AssetType;
  mimeType: string;
  /** URI de stockage interne (s3://…), jamais exposée directement : accès par URL signée courte. */
  storageUri: string;
  sha256: string;
  sizeBytes: number;
  name: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
}

export interface RenderVersion {
  id: Uuid;
  shotId: Uuid;
  parentVersionId: Uuid | null;
  sceneRevisionId: Uuid;
  generationJobId: Uuid | null;
  outputAssetId: Uuid;
  label: string;
  notes: string;
  status: 'draft' | 'approved' | 'rejected';
  createdAt: IsoDateTime;
}
