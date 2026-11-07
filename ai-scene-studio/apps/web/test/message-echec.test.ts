import type { GenerationJob } from '@ass/api-client';
import { describe, expect, it } from 'vitest';
import { messageEchec } from '@/editor/AiPanel';

const echec = (errorDetails: string | null, actualCost: number | null) =>
  ({ status: 'failed', errorDetails, actualCost, message: 'x' }) as unknown as GenerationJob;

describe('échec dit en clair', () => {
  it('donne la raison et précise qu’aucun crédit n’est parti', () => {
    expect(messageEchec(echec('unknown: ', null))).toBe(
      'Le moteur a refusé la demande. Aucun crédit dépensé.',
    );
    expect(messageEchec(echec('authentication: no_auth', 0))).toBe(
      'Higgsfield n’est plus connecté dans Chrome. Aucun crédit dépensé.',
    );
    expect(messageEchec(echec('timeout: x', 13.75))).toBe('Le moteur n’a pas répondu à temps.');
  });
});
