'use client';

import type { Project, Sequence, Shot } from '@ass/api-client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, ErrorText, Field } from '@/components/ui';
import { api, call } from '@/lib/api';
import { moveItem } from '@/lib/order';
import { formatDuration, formatFps } from '@/lib/presets';

interface Props {
  sequence: Sequence;
  project: Project;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (offset: -1 | 1) => void;
  onChanged: () => void;
}

export function SequenceCard({
  sequence,
  project,
  canEdit,
  isFirst,
  isLast,
  onMove,
  onChanged,
}: Props) {
  const sequence_id = sequence.id;
  const [shots, setShots] = useState<Shot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [shotName, setShotName] = useState('');
  const [frames, setFrames] = useState('120');
  const [name, setName] = useState(sequence.name);

  const refresh = useCallback(() => {
    call(api.GET('/sequences/{sequence_id}/shots', { params: { path: { sequence_id } } }))
      .then(setShots)
      .catch((reason: Error) => setError(reason.message));
  }, [sequence_id]);

  useEffect(refresh, [refresh]);

  const act = (request: Promise<unknown>) =>
    request
      .then(() => {
        setError(null);
        refresh();
      })
      .catch((reason: Error) => setError(reason.message));

  return (
    <article
      aria-label={`Séquence ${sequence.name}`}
      className="rounded-lg border border-border bg-panel p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">
          <span className="text-muted">{sequence.orderIndex + 1}.</span> {sequence.name}
        </h3>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              aria-label={`Monter ${sequence.name}`}
              disabled={isFirst}
              onClick={() => onMove(-1)}
            >
              ↑
            </Button>
            <Button
              aria-label={`Descendre ${sequence.name}`}
              disabled={isLast}
              onClick={() => onMove(1)}
            >
              ↓
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!window.confirm(`Supprimer la séquence « ${sequence.name} » et ses plans ?`))
                  return;
                call(api.DELETE('/sequences/{sequence_id}', { params: { path: { sequence_id } } }))
                  .then(onChanged)
                  .catch((reason: Error) => setError(reason.message));
              }}
            >
              Supprimer
            </Button>
          </div>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      <ol className="mt-3 divide-y divide-border">
        {shots.map((shot, index) => (
          <li
            key={shot.id}
            className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
          >
            <span>
              <span className="text-muted">{index + 1}.</span>{' '}
              <Link href={`/shots/${shot.id}/editor`} className="hover:text-accent">
                {shot.name}
              </Link>
              <span className="ml-2 text-xs text-muted">
                {shot.durationFrames} frames ·{' '}
                {formatDuration(shot.durationFrames, shot.effectiveFps)} ·{' '}
                {formatFps(shot.effectiveFps)} i/s{shot.fps ? ' (propre au plan)' : ''}
              </span>
            </span>
            {canEdit && (
              <span className="flex gap-2">
                <Button
                  aria-label={`Monter ${shot.name}`}
                  disabled={index === 0}
                  onClick={() =>
                    void act(
                      call(
                        api.PUT('/sequences/{sequence_id}/shots/order', {
                          params: { path: { sequence_id } },
                          body: {
                            shotIds: moveItem(
                              shots.map((s) => s.id),
                              shot.id,
                              -1,
                            ),
                          },
                        }),
                      ),
                    )
                  }
                >
                  ↑
                </Button>
                <Button
                  aria-label={`Descendre ${shot.name}`}
                  disabled={index === shots.length - 1}
                  onClick={() =>
                    void act(
                      call(
                        api.PUT('/sequences/{sequence_id}/shots/order', {
                          params: { path: { sequence_id } },
                          body: {
                            shotIds: moveItem(
                              shots.map((s) => s.id),
                              shot.id,
                              1,
                            ),
                          },
                        }),
                      ),
                    )
                  }
                >
                  ↓
                </Button>
                <Button
                  variant="danger"
                  aria-label={`Supprimer ${shot.name}`}
                  onClick={() =>
                    void act(
                      call(
                        api.DELETE('/shots/{shot_id}', { params: { path: { shot_id: shot.id } } }),
                      ),
                    )
                  }
                >
                  Supprimer
                </Button>
              </span>
            )}
          </li>
        ))}
        {shots.length === 0 && <li className="py-2 text-sm text-muted">Aucun plan.</li>}
      </ol>
      {canEdit && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void act(
                call(
                  api.POST('/sequences/{sequence_id}/shots', {
                    params: { path: { sequence_id } },
                    body: { name: shotName, durationFrames: Number(frames) },
                  }),
                ).then(() => setShotName('')),
              );
            }}
          >
            <Field
              label="Nouveau plan"
              required
              maxLength={200}
              value={shotName}
              onChange={(e) => setShotName(e.target.value)}
            />
            <Field
              label="Durée (frames)"
              type="number"
              min={1}
              required
              value={frames}
              onChange={(e) => setFrames(e.target.value)}
              hint={`à ${formatFps(project.fps)} i/s sauf cadence propre`}
            />
            <Button type="submit" variant="primary">
              Ajouter le plan
            </Button>
          </form>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              call(
                api.PATCH('/sequences/{sequence_id}', {
                  params: { path: { sequence_id } },
                  body: { name },
                }),
              )
                .then(onChanged)
                .catch((reason: Error) => setError(reason.message));
            }}
          >
            <Field
              label="Nom de la séquence"
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit">Renommer</Button>
          </form>
        </div>
      )}
    </article>
  );
}
