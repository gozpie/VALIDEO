/**
 * Contrats des entités persistées, tels qu'exposés par l'API (JSON, dates ISO 8601 UTC).
 * Les identifiants sont des UUID stables. Le backend (Pydantic/SQLAlchemy) est la référence
 * d'implémentation ; ces types seront générés depuis l'OpenAPI à partir de la phase 1.
 */
export type Uuid = string;
export type IsoDateTime = string;

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface User {
  id: Uuid;
  email: string;
  displayName: string;
  createdAt: IsoDateTime;
}

export interface Workspace {
  id: Uuid;
  name: string;
  createdAt: IsoDateTime;
}

export interface WorkspaceMember {
  workspaceId: Uuid;
  userId: Uuid;
  role: WorkspaceRole;
}

export type ColorSpace = 'srgb' | 'rec709' | 'acescg' | 'linear_rec709';

export interface Project {
  id: Uuid;
  workspaceId: Uuid;
  name: string;
  description: string;
  fps: { numerator: number; denominator: number };
  resolution: { width: number; height: number };
  colorSpace: ColorSpace;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Sequence {
  id: Uuid;
  projectId: Uuid;
  name: string;
  orderIndex: number;
}

export interface Shot {
  id: Uuid;
  sequenceId: Uuid;
  name: string;
  orderIndex: number;
  durationFrames: number;
  sceneId: Uuid;
  activeCameraId: Uuid | null;
  activeRevisionId: Uuid | null;
}

export interface Scene {
  id: Uuid;
  projectId: Uuid;
  headRevisionId: Uuid | null;
}

/** Révision immuable d'une scène : le snapshot JSON n'est jamais modifié après création. */
export interface SceneRevision {
  id: Uuid;
  sceneId: Uuid;
  parentRevisionId: Uuid | null;
  schemaVersion: number;
  snapshotUri: string;
  /** SHA-256 hexadécimal du snapshot canonique. */
  contentHash: string;
  authorId: Uuid;
  message: string;
  createdAt: IsoDateTime;
}

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
