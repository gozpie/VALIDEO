import type { JobStatus } from '@ass/shared-types';
import type { CapabilityMismatch, GenerationRequest, ProviderCapabilities } from './capabilities';

export interface CostEstimate {
  amount: number;
  currency: string;
  /** Explication lisible du calcul (ex. « 5 s × 0,10 €/s »). */
  basis: string;
}

export interface SubmittedGeneration {
  /** Identifiant du job chez le fournisseur. */
  externalId: string;
}

export interface ProviderJobStatus {
  status: JobStatus;
  progress: number | null;
}

export interface ProviderOutput {
  url: string;
  mimeType: string;
  /** Métadonnées renvoyées par le fournisseur (seed effectif, version du modèle…). */
  metadata: Record<string, unknown>;
}

export interface NormalizedProviderError {
  code:
    | 'invalid_request'
    | 'authentication'
    | 'quota_exceeded'
    | 'rate_limited'
    | 'content_policy'
    | 'timeout'
    | 'provider_unavailable'
    | 'unknown';
  message: string;
  retryable: boolean;
  /** Détail brut du fournisseur, sans secret, pour les logs. */
  providerDetail?: string;
}

/**
 * Contrat que doit implémenter chaque intégration de fournisseur IA (API officielle ou modèle
 * local/ComfyUI). Implémenté côté serveur uniquement : les clés ne quittent jamais le backend.
 */
export interface ProviderAdapter {
  getCapabilities(): Promise<ProviderCapabilities[]>;
  validateRequest(request: GenerationRequest): Promise<CapabilityMismatch[]>;
  estimateCost(request: GenerationRequest): Promise<CostEstimate | null>;
  submitGeneration(
    request: GenerationRequest,
    options: { idempotencyKey: string; signal?: AbortSignal },
  ): Promise<SubmittedGeneration>;
  getJobStatus(externalId: string): Promise<ProviderJobStatus>;
  cancelGeneration(externalId: string): Promise<void>;
  retrieveOutputs(externalId: string): Promise<ProviderOutput[]>;
  normalizeError(error: unknown): NormalizedProviderError;
}
