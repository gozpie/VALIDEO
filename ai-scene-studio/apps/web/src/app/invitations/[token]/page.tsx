'use client';

import type { InvitationPreview } from '@ass/api-client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthScreen } from '@/components/AuthScreen';
import { useAuth } from '@/components/AuthProvider';
import { Button, ErrorText, Field } from '@/components/ui';
import { api, call } from '@/lib/api';

export default function InvitationPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { state, signedIn } = useAuth();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    call(api.GET('/invitations/{token}', { params: { path: { token } } }))
      .then(setPreview)
      .catch((reason: Error) => setError(reason.message));
  }, [token]);

  if (!preview)
    return (
      <AuthScreen>
        {error ? <ErrorText>{error}</ErrorText> : <p className="text-muted">Chargement…</p>}
      </AuthScreen>
    );

  const accept = (body: { displayName?: string; password?: string }) =>
    call(api.POST('/invitations/{token}/accept', { params: { path: { token } }, body }))
      .then((session) => {
        signedIn(session);
        router.push('/workspaces');
      })
      .catch((reason: Error) => setError(reason.message));

  const signedInAs = state.status === 'authenticated' ? state.session.user.email : null;

  return (
    <AuthScreen>
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-bold tracking-tight">Invitation</h1>
        <p className="text-sm">
          Rejoindre <strong>{preview.workspaceName}</strong> en tant que{' '}
          <strong>{preview.role}</strong> avec l’adresse <strong>{preview.email}</strong>.
        </p>
        <ErrorText>{error}</ErrorText>
        {preview.accountExists ? (
          signedInAs === preview.email ? (
            <Button variant="primary" onClick={() => void accept({})}>
              Accepter l’invitation
            </Button>
          ) : (
            <p className="text-sm">
              Un compte existe pour cette adresse :{' '}
              <Link
                href={`/login?next=${encodeURIComponent(`/invitations/${token}`)}`}
                className="text-accent hover:underline"
              >
                connectez-vous avec ce compte
              </Link>{' '}
              pour accepter.
            </p>
          )
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void accept({ displayName, password });
            }}
          >
            <Field
              label="Nom affiché"
              required
              maxLength={120}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <Field
              label="Mot de passe"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint="12 caractères minimum"
            />
            <Button type="submit" variant="primary">
              Créer mon compte et rejoindre
            </Button>
          </form>
        )}
      </div>
    </AuthScreen>
  );
}
