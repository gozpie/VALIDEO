import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema.gen';

export type { components, paths };

type Schemas = components['schemas'];

/** Entités telles qu'exposées par l'API (générées depuis son contrat OpenAPI). */
export type User = Schemas['UserOut'];
export type Session = Schemas['SessionOut'];
export type Workspace = Schemas['WorkspaceOut'];
export type WorkspaceRole = Workspace['role'];
export type Member = Schemas['MemberOut'];
export type Invitation = Schemas['InvitationOut'];
export type CreatedInvitation = Schemas['CreatedInvitationOut'];
export type InvitationPreview = Schemas['InvitationPreviewOut'];
export type Project = Schemas['ProjectOut'];
export type ColorSpace = Project['colorSpace'];
export type Fps = Schemas['Fps'];
export type Resolution = Schemas['Resolution'];
export type Sequence = Schemas['SequenceOut'];
export type Shot = Schemas['ShotOut'];
export type Asset = Schemas['AssetOut'];
export type AssetType = Asset['type'];
export type UploadedAsset = Schemas['UploadedAssetOut'];
export type SceneState = Schemas['SceneStateOut'];
export type SceneRevision = Schemas['RevisionOut'];
export type SaveRevisionResult = Schemas['SaveRevisionOut'];
export type RenderJob = Schemas['RenderJobOut'];
export type RenderPass = Schemas['RenderIn']['passes'] extends (infer P)[] | undefined ? P : never;
export type AiProvider = Schemas['ProviderOut'];
export type AiModel = Schemas['ModelOut'];
export type GenerationInput = Schemas['GenerationIn'];
export type GenerationMode = GenerationInput['mode'];
export type GenerationEstimate = Schemas['EstimateOut'];
export type GenerationJob = Schemas['GenerationJobOut'];
export type Problem = Schemas['ProblemOut'];
export type Page<T> = { items: T[]; nextCursor: string | null };

export const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Réponses qui portent un nouveau jeton CSRF (corps `Session`). */
const SESSION_PATHS = [/\/auth\/login$/, /\/auth\/session$/, /\/invitations\/[^/]+\/accept$/];

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export interface ApiClient extends Client<paths> {
  /** Jeton CSRF de la session courante, ou `null` si aucune session n'est connue. */
  readonly csrfToken: string | null;
}

/**
 * Client typé de l'API. Les cookies de session sont envoyés (`credentials: "include"`) et le jeton
 * CSRF, mémorisé à chaque réponse de session, est ajouté aux requêtes modifiantes.
 */
export function createApiClient({ baseUrl, fetch }: ApiClientOptions): ApiClient {
  let csrfToken: string | null = null;
  const middleware: Middleware = {
    onRequest({ request }) {
      if (!SAFE_METHODS.has(request.method) && csrfToken) {
        request.headers.set(CSRF_HEADER, csrfToken);
      }
      return request;
    },
    async onResponse({ request, response }) {
      const path = new URL(request.url).pathname;
      if (response.ok && SESSION_PATHS.some((pattern) => pattern.test(path))) {
        const body = (await response.clone().json()) as { csrfToken?: unknown };
        csrfToken = typeof body.csrfToken === 'string' ? body.csrfToken : null;
      } else if (response.status === 401 || (response.ok && path.endsWith('/auth/logout'))) {
        csrfToken = null;
      }
      return response;
    },
  };
  const client = createClient<paths>({
    baseUrl,
    credentials: 'include',
    ...(fetch ? { fetch } : {}),
  });
  client.use(middleware);
  return Object.defineProperty(client, 'csrfToken', { get: () => csrfToken }) as ApiClient;
}
