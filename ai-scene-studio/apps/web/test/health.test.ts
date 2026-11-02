import { describe, expect, it, vi } from 'vitest';
import { fetchApiHealth } from '@/lib/health';

const healthBody = {
  status: 'ok',
  version: '0.1.0',
  checks: { database: { status: 'ok' } },
};

const respond = (status: number, body: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('fetchApiHealth', () => {
  it('retourne ready sur un 200', async () => {
    const state = await fetchApiHealth('http://api', respond(200, healthBody));
    expect(state).toEqual({ kind: 'ready', health: healthBody });
  });

  it('retourne unavailable sur un 503 avec un corps valide', async () => {
    const state = await fetchApiHealth(
      'http://api',
      respond(503, { ...healthBody, status: 'error' }),
    );
    expect(state.kind).toBe('unavailable');
  });

  it('retourne unreachable sur une erreur réseau', async () => {
    const failing = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await fetchApiHealth('http://api', failing)).toEqual({
      kind: 'unreachable',
      message: 'API injoignable',
    });
  });

  it('retourne unreachable sur un corps inattendu', async () => {
    const state = await fetchApiHealth('http://api', respond(200, { foo: 1 }));
    expect(state.kind).toBe('unreachable');
  });
});
