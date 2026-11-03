'use client';

import type { Workspace } from '@ass/api-client';
import { ArrowRight, FolderKanban, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { RequireAuth } from '@/components/RequireAuth';
import { Button, ErrorText, Field, Panel } from '@/components/ui';
import { api, call } from '@/lib/api';
import { usePaged } from '@/lib/usePaged';

const ROLE_LABELS: Record<Workspace['role'], string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  editor: 'Éditeur',
  viewer: 'Lecteur',
};

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
    <AppShell page="workspaces" crumbs={[]} title="Workspaces">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <ErrorText>{list.error}</ErrorText>
        {!list.loading && list.items.length === 0 && (
          <EmptyState icon={<FolderKanban size={24} />} title="Aucun workspace pour l’instant">
            Créez votre premier espace de travail ci-dessous.
          </EmptyState>
        )}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
          {list.items.map((workspace) => (
            <li key={workspace.id}>
              <Link
                href={`/workspaces/${workspace.id}`}
                className="group flex items-center gap-3.5 rounded-2xl border border-border bg-panel p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-border-strong"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-ai text-lg font-bold text-white">
                  {workspace.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{workspace.name}</span>
                  <span className="block text-xs text-muted">{ROLE_LABELS[workspace.role]}</span>
                </span>
                <ArrowRight
                  size={16}
                  className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-text"
                />
              </Link>
            </li>
          ))}
        </ul>
        {list.hasMore && (
          <Button
            className="self-center"
            onClick={() => void list.loadMore()}
            disabled={list.loading}
          >
            Charger plus
          </Button>
        )}
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
            <Button type="submit" variant="primary" className="h-10">
              <Plus size={15} /> Créer
            </Button>
          </form>
          <ErrorText>{error}</ErrorText>
        </Panel>
      </div>
    </AppShell>
  );
}

export default function WorkspacesPage() {
  return <RequireAuth>{() => <Workspaces />}</RequireAuth>;
}
