'use client';

import type { Workspace } from '@ass/api-client';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { RequireAuth } from '@/components/RequireAuth';
import { Button, ErrorText, Field, Panel } from '@/components/ui';
import { api, call } from '@/lib/api';
import { usePaged } from '@/lib/usePaged';

function Workspaces() {
  const fetchPage = useCallback(
    (cursor: string | null) =>
      call(api.GET('/workspaces', { params: { query: cursor ? { cursor } : {} } })),
    [],
  );
  const list = usePaged<Workspace>(fetchPage);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Mes workspaces</h1>
      <Panel title="Nouveau workspace">
        <form
          className="flex items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            call(api.POST('/workspaces', { body: { name } }))
              .then(() => {
                setName('');
                setError(null);
                return list.reload();
              })
              .catch((reason: Error) => setError(reason.message));
          }}
        >
          <div className="flex-1">
            <Field
              label="Nom"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" variant="primary">
            Créer
          </Button>
        </form>
        <ErrorText>{error}</ErrorText>
      </Panel>
      <Panel title="Workspaces">
        <ErrorText>{list.error}</ErrorText>
        {!list.loading && list.items.length === 0 && (
          <p className="text-sm text-muted">Aucun workspace pour l’instant.</p>
        )}
        <ul className="divide-y divide-border">
          {list.items.map((workspace) => (
            <li key={workspace.id} className="flex items-center justify-between py-2">
              <Link href={`/workspaces/${workspace.id}`} className="hover:text-accent">
                {workspace.name}
              </Link>
              <span className="text-xs text-muted">{workspace.role}</span>
            </li>
          ))}
        </ul>
        {list.hasMore && (
          <Button className="mt-3" onClick={() => void list.loadMore()} disabled={list.loading}>
            Charger plus
          </Button>
        )}
      </Panel>
    </div>
  );
}

export default function WorkspacesPage() {
  return <RequireAuth>{() => <Workspaces />}</RequireAuth>;
}
