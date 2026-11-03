'use client';

import type { Session } from '@ass/api-client';
import { useState } from 'react';
import { Button, ErrorText, Field } from '@/components/ui';
import { api, call } from '@/lib/api';

export function LoginForm({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        call(api.POST('/auth/login', { body: { email, password } }))
          .then(onSignedIn)
          .catch((reason: Error) => setError(reason.message))
          .finally(() => setPending(false));
      }}
    >
      <Field
        label="E-mail"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Field
        label="Mot de passe"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Connexion…' : 'Se connecter'}
      </Button>
    </form>
  );
}
