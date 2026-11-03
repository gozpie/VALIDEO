'use client';

import type {
  AiProvider,
  BibleEntry,
  GenerationJob,
  ScriptSummary,
  StoryboardSequence,
} from '@ass/api-client';
import { useCallback, useEffect, useState } from 'react';
import { api, call } from '@/lib/api';
import { API_URL } from '@/lib/config';

export const assetUrl = (id: string) => `${API_URL}/assets/${id}/content`;
export const DONE = new Set(['completed', 'failed', 'cancelled']);

/** Lecture rafraîchissable d'une ressource de l'API. */
function useResource<T>(load: () => Promise<T>, initial: T): [T, () => void, string | null] {
  const [value, setValue] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    load()
      .then((next) => {
        setValue(next);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [load]);
  useEffect(refresh, [refresh]);
  return [value, refresh, error];
}

export function useScripts(projectId: string) {
  const load = useCallback(
    () =>
      call(
        api.GET('/projects/{project_id}/scripts', { params: { path: { project_id: projectId } } }),
      ),
    [projectId],
  );
  return useResource<ScriptSummary[]>(load, []);
}

export function useBible(projectId: string) {
  const load = useCallback(
    () =>
      call(
        api.GET('/projects/{project_id}/bible', { params: { path: { project_id: projectId } } }),
      ),
    [projectId],
  );
  return useResource<BibleEntry[]>(load, []);
}

export function useStoryboard(projectId: string) {
  const load = useCallback(
    () =>
      call(
        api.GET('/projects/{project_id}/storyboard', {
          params: { path: { project_id: projectId } },
        }),
      ),
    [projectId],
  );
  return useResource<StoryboardSequence[]>(load, []);
}

export function useProviders(): AiProvider[] {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      call(api.GET('/ai/providers'))
        .then((list) => alive && setProviders(list))
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return providers;
}

/**
 * Générations suivies (projet ou plan), interrogées tant qu'une est active ; `onDone` est appelé
 * une fois par génération qui se termine pendant que l'écran est ouvert.
 */
export function useJobs(
  load: () => Promise<GenerationJob[]>,
  onDone?: (job: GenerationJob) => void,
): [GenerationJob[], () => void, (job: GenerationJob) => void] {
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [watched] = useState(() => new Set<string>());
  const refresh = useCallback(() => {
    load()
      .then((list) => {
        setJobs(list);
        for (const job of list) {
          if (watched.has(job.id) && DONE.has(job.status)) {
            watched.delete(job.id);
            onDone?.(job);
          }
        }
      })
      .catch(() => undefined);
  }, [load, onDone, watched]);
  useEffect(refresh, [refresh]);
  const active = jobs.some((job) => !DONE.has(job.status));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [active, refresh]);
  const track = useCallback(
    (job: GenerationJob) => {
      watched.add(job.id);
      setJobs((list) => [job, ...list.filter((j) => j.id !== job.id)]);
    },
    [watched],
  );
  return [jobs, refresh, track];
}

export const BIBLE_LABELS: Record<BibleEntry['kind'], { one: string; many: string }> = {
  look: { one: 'LOOK', many: 'LOOK du film' },
  character: { one: 'Personnage', many: 'Personnages' },
  set: { one: 'Décor', many: 'Décors' },
  prop: { one: 'Accessoire', many: 'Accessoires' },
};

export const APPROACH_LABELS = {
  image_to_video: 'Image → vidéo',
  multishot: 'Multiplan',
  text_to_video: 'Texte → vidéo',
  still: 'Image fixe',
  scene_3d: 'Scène 3D',
} as const;

export const STATUS_LABELS = {
  todo: 'À faire',
  in_progress: 'En cours',
  review: 'À valider',
  approved: 'Validé',
} as const;

export const STATUS_TONES = {
  todo: 'bg-border text-muted',
  in_progress: 'bg-ai/15 text-ai',
  review: 'bg-warn/15 text-warn',
  approved: 'bg-ok/15 text-ok',
} as const;
