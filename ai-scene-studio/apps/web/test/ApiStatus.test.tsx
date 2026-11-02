import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiStatus } from '@/components/ApiStatus';

afterEach(() => vi.unstubAllGlobals());

describe('<ApiStatus />', () => {
  it('affiche l’état de chaque dépendance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'error',
            version: '0.1.0',
            checks: { database: { status: 'ok' }, storage: { status: 'error', detail: 'timeout' } },
          }),
          { status: 503 },
        ),
      ),
    );
    render(<ApiStatus apiUrl="http://api" />);
    expect(await screen.findByText(/dégradée/)).toBeInTheDocument();
    expect(screen.getByText('Base de données').nextSibling).toHaveTextContent('OK');
    expect(screen.getByText('Stockage médias (S3)').nextSibling).toHaveTextContent(
      'Erreur : timeout',
    );
  });

  it('signale une API injoignable et permet de revérifier', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', fetchMock);
    render(<ApiStatus apiUrl="http://api" />);
    expect(await screen.findByText(/API injoignable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revérifier' }));
    expect(await screen.findByText(/API injoignable/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
