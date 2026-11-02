import type { IsoDateTime, Uuid } from './entities';

export const JOB_STATUSES = [
  'queued',
  'preparing',
  'running',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

/**
 * Transitions autorisées de la machine à états des jobs.
 * Un job terminal ne repart jamais : une relance crée un nouveau job (jamais de relance
 * silencieuse d'une opération payante).
 */
export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ['preparing', 'cancelled', 'failed'],
  preparing: ['running', 'cancelled', 'failed'],
  running: ['processing', 'cancelled', 'failed'],
  processing: ['completed', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

export type JobType = 'render' | 'media' | 'generation';

export interface JobCost {
  /** Montant estimé avant soumission, en unités de la devise. */
  estimated: number | null;
  /** Montant réellement facturé, si le fournisseur le communique. */
  actual: number | null;
  currency: string;
}

export interface GenerationJob {
  id: Uuid;
  workspaceId: Uuid;
  userId: Uuid;
  type: JobType;
  provider: string;
  model: string;
  modelVersion: string | null;
  sceneRevisionId: Uuid;
  /** Clé d'idempotence fournie par le client pour éviter les doubles soumissions. */
  idempotencyKey: string;
  status: JobStatus;
  progress: number;
  inputManifest: Record<string, unknown>;
  outputManifest: Record<string, unknown> | null;
  cost: JobCost;
  error: { code: string; message: string; retryable: boolean } | null;
  createdAt: IsoDateTime;
  startedAt: IsoDateTime | null;
  finishedAt: IsoDateTime | null;
}
