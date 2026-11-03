import { describe, expect, it } from 'vitest';
import { CSRF_HEADER, createApiClient } from '../src';

const SESSION = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'pierre@example.test',
    displayName: 'Pierre',
    createdAt: '2026-11-03T00:00:00Z',
  },
  csrfToken: 'jeton-csrf',
  expiresAt: '2026-11-17T00:00:00Z',
};

function fakeFetch(responses: Record<string, Response>) {
  const requests: Request[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    const key = `${request.method} ${new URL(request.url).pathname}`;
    return Promise.resolve(responses[key]?.clone() ?? new Response(null, { status: 404 }));
  };
  return { fetch, requests };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('client API', () => {
  it('mémorise le jeton CSRF et l’ajoute aux requêtes modifiantes seulement', async () => {
    const { fetch, requests } = fakeFetch({
      'POST /auth/login': json(SESSION),
      'GET /workspaces': json({ items: [], nextCursor: null }),
      'POST /workspaces': json({}, 201),
      'POST /auth/logout': new Response(null, { status: 204 }),
    });
    const api = createApiClient({ baseUrl: 'http://api.test', fetch });

    await api.POST('/auth/login', { body: { email: 'pierre@example.test', password: 'x' } });
    expect(api.csrfToken).toBe('jeton-csrf');
    expect(requests[0]!.headers.get(CSRF_HEADER)).toBeNull();
    expect(requests[0]!.credentials).toBe('include');

    await api.GET('/workspaces');
    expect(requests[1]!.headers.get(CSRF_HEADER)).toBeNull();

    await api.POST('/workspaces', { body: { name: 'Studio' } });
    expect(requests[2]!.headers.get(CSRF_HEADER)).toBe('jeton-csrf');

    await api.POST('/auth/logout');
    expect(api.csrfToken).toBeNull();
  });

  it('oublie le jeton quand la session est refusée', async () => {
    const { fetch } = fakeFetch({
      'GET /auth/session': json(SESSION),
    });
    const api = createApiClient({ baseUrl: 'http://api.test', fetch });
    await api.GET('/auth/session');
    expect(api.csrfToken).toBe('jeton-csrf');

    const refused = createApiClient({
      baseUrl: 'http://api.test',
      fetch: () => Promise.resolve(json({ status: 401 }, 401)),
    });
    const { error, response } = await refused.GET('/auth/session');
    expect(response.status).toBe(401);
    expect(error).toEqual({ status: 401 });
    expect(refused.csrfToken).toBeNull();
  });
});
