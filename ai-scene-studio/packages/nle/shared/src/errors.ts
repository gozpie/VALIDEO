/**
 * Taxonomie d erreurs presentables a l utilisateur (section 106).
 *
 * Une erreur affichee doit dire ce qui s est passe, ce que l utilisateur peut
 * faire, et conserver le detail technique pour le diagnostic -- sans jamais
 * degenerer en "Une erreur est survenue".
 */

export type ErrorCode =
  // Media
  | 'MEDIA_OFFLINE'
  | 'MEDIA_UNREADABLE'
  | 'CODEC_REQUIRES_PROXY'
  | 'CODEC_UNSUPPORTED'
  | 'PROXY_GENERATION_FAILED'
  | 'VARIABLE_FRAME_RATE'
  // Montage
  | 'EDIT_REJECTED'
  | 'TRACK_LOCKED'
  | 'TRACK_NOT_FOUND'
  | 'CLIP_NOT_FOUND'
  | 'SEQUENCE_NOT_FOUND'
  | 'CIRCULAR_NESTING'
  | 'TIMEBASE_MISMATCH'
  // Stockage et reseau
  | 'INSUFFICIENT_DISK_SPACE'
  | 'UPLOAD_INTERRUPTED'
  | 'STORAGE_UNAVAILABLE'
  // Rendu
  | 'EXPORT_FAILED'
  | 'RENDER_FAILED'
  // Projet
  | 'PROJECT_SCHEMA_TOO_NEW'
  | 'PROJECT_CORRUPT'
  | 'MIGRATION_FAILED';

export interface AppError {
  readonly code: ErrorCode;
  /** Message court destine a l utilisateur, en francais, sans jargon inutile. */
  readonly message: string;
  /** Action proposee : "Relier le media", "Generer un proxy", "Reessayer". */
  readonly action?: string;
  /** Detail technique, affiche derriere un depliant. Jamais perdu. */
  readonly detail?: string;
  /** Vrai si relancer l operation a une chance d aboutir. */
  readonly retryable?: boolean;
}

export function appError(
  code: ErrorCode,
  message: string,
  extra: Omit<AppError, 'code' | 'message'> = {},
): AppError {
  return { code, message, ...extra };
}

/**
 * Erreur d invariant interne : un identifiant inconnu, un etat impossible.
 * Ce n est PAS une erreur utilisateur, c est un bug qui doit remonter.
 */
export class InvariantError extends Error {
  constructor(message: string) {
    super(`Invariant casse: ${message}`);
    this.name = 'InvariantError';
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError(message);
}
