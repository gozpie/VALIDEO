import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '@/components/LoginForm';
import type * as ApiModule from '@/lib/api';

const post = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { POST: (...args: unknown[]) => post(...args) },
}));

const SESSION = {
  user: { id: 'u1', email: 'pierre@example.test', displayName: 'Pierre', createdAt: '' },
  csrfToken: 'csrf',
  expiresAt: '',
};

function fill() {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pierre@example.test' } });
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'un mot de passe' } });
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
}

describe('<LoginForm />', () => {
  beforeEach(() => post.mockReset());

  it('envoie les identifiants et transmet la session', async () => {
    post.mockResolvedValue({ data: SESSION, response: new Response(null, { status: 200 }) });
    const onSignedIn = vi.fn();
    render(<LoginForm onSignedIn={onSignedIn} />);
    fill();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(SESSION));
    expect(post).toHaveBeenCalledWith('/auth/login', {
      body: { email: 'pierre@example.test', password: 'un mot de passe' },
    });
  });

  it('affiche le message d’erreur de l’API', async () => {
    post.mockResolvedValue({
      error: { detail: 'E-mail ou mot de passe incorrect' },
      response: new Response(null, { status: 401 }),
    });
    const onSignedIn = vi.fn();
    render(<LoginForm onSignedIn={onSignedIn} />);
    fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou mot de passe incorrect');
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
