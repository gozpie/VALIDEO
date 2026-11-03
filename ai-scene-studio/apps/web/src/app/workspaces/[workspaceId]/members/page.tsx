'use client';

import type { CreatedInvitation, Invitation, Member, Session, Workspace } from '@ass/api-client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '@/components/RequireAuth';
import { Select } from '@/components/Select';
import { Button, ErrorText, Field, Panel } from '@/components/ui';
import { api, call } from '@/lib/api';

type InvitableRole = Invitation['role'];
const ROLE_OPTIONS: { label: string; value: InvitableRole }[] = [
  { label: 'Lecture (viewer)', value: 'viewer' },
  { label: 'Édition (editor)', value: 'editor' },
  { label: 'Administration (admin)', value: 'admin' },
];

function MembersView({ workspaceId, session }: { workspaceId: string; session: Session }) {
  const router = useRouter();
  const path = { workspace_id: workspaceId };
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('editor');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const current = await call(
        api.GET('/workspaces/{workspace_id}', { params: { path: { workspace_id: workspaceId } } }),
      );
      setWorkspace(current);
      setMembers(
        await call(
          api.GET('/workspaces/{workspace_id}/members', {
            params: { path: { workspace_id: workspaceId } },
          }),
        ),
      );
      if (current.role === 'admin' || current.role === 'owner') {
        setInvitations(
          await call(
            api.GET('/workspaces/{workspace_id}/invitations', {
              params: { path: { workspace_id: workspaceId } },
            }),
          ),
        );
      }
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!workspace)
    return error ? <ErrorText>{error}</ErrorText> : <p className="text-muted">Chargement…</p>;
  const isAdmin = workspace.role === 'admin' || workspace.role === 'owner';
  const act = (request: Promise<unknown>) =>
    request.then(() => refresh()).catch((reason: Error) => setError(reason.message));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Membres — {workspace.name}</h1>
        <Link href={`/workspaces/${workspaceId}`} className="text-sm text-accent hover:underline">
          ← Projets
        </Link>
      </div>
      <ErrorText>{error}</ErrorText>
      <Panel title="Membres">
        <ul className="divide-y divide-border">
          {members.map((member) => {
            const isSelf = member.userId === session.user.id;
            const user_id = member.userId;
            return (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <span>
                  {member.displayName} <span className="text-xs text-muted">{member.email}</span>
                </span>
                <span className="flex items-center gap-2">
                  {isAdmin && member.role !== 'owner' ? (
                    <select
                      aria-label={`Rôle de ${member.displayName}`}
                      value={member.role}
                      onChange={(event) =>
                        void act(
                          call(
                            api.PATCH('/workspaces/{workspace_id}/members/{user_id}', {
                              params: { path: { ...path, user_id } },
                              body: { role: event.target.value as InvitableRole },
                            }),
                          ),
                        )
                      }
                      className="rounded border border-border bg-surface px-2 py-1 text-sm"
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-muted">{member.role}</span>
                  )}
                  {member.role !== 'owner' && (isAdmin || isSelf) && (
                    <Button
                      variant="danger"
                      onClick={() => {
                        const question = isSelf
                          ? 'Quitter ce workspace ?'
                          : `Retirer ${member.displayName} ?`;
                        if (!window.confirm(question)) return;
                        call(
                          api.DELETE('/workspaces/{workspace_id}/members/{user_id}', {
                            params: { path: { ...path, user_id } },
                          }),
                        )
                          .then(() => (isSelf ? router.push('/workspaces') : refresh()))
                          .catch((reason: Error) => setError(reason.message));
                      }}
                    >
                      {isSelf ? 'Quitter' : 'Retirer'}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
      {isAdmin && (
        <Panel title="Inviter">
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              call(
                api.POST('/workspaces/{workspace_id}/invitations', {
                  params: { path },
                  body: { email, role },
                }),
              )
                .then((invitation) => {
                  setCreated(invitation);
                  setEmail('');
                  setError(null);
                  return refresh();
                })
                .catch((reason: Error) => setError(reason.message));
            }}
          >
            <Field
              label="E-mail"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Select
              label="Rôle"
              value={role}
              onChange={(value) => setRole(value as InvitableRole)}
              options={ROLE_OPTIONS}
            />
            <Button type="submit" variant="primary">
              Créer le lien d’invitation
            </Button>
          </form>
          {created && (
            <div className="mt-4 rounded border border-accent p-3 text-sm">
              <p>
                Lien pour <strong>{created.email}</strong>, affiché une seule fois : transmettez-le
                à la personne invitée (aucun e-mail n’est envoyé).
              </p>
              <input
                readOnly
                aria-label="Lien d’invitation"
                value={created.acceptUrl}
                onFocus={(event) => event.target.select()}
                className="mt-2 w-full rounded border border-border bg-surface px-2 py-1 font-mono text-xs"
              />
            </div>
          )}
          {invitations.length > 0 && (
            <ul className="mt-4 divide-y divide-border">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {invitation.email} <span className="text-xs text-muted">{invitation.role}</span>
                  </span>
                  <Button
                    variant="danger"
                    onClick={() =>
                      void act(
                        call(
                          api.DELETE('/workspaces/{workspace_id}/invitations/{invitation_id}', {
                            params: { path: { ...path, invitation_id: invitation.id } },
                          }),
                        ),
                      )
                    }
                  >
                    Révoquer
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}

export default function MembersPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <RequireAuth>
      {(session) => <MembersView workspaceId={workspaceId} session={session} />}
    </RequireAuth>
  );
}
