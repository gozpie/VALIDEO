import { describe, expect, it } from 'vitest';
import { JOB_STATUSES, JOB_TRANSITIONS, canTransitionJob, isTerminalJobStatus } from '../src';

describe('machine à états des jobs', () => {
  it('suit le chemin nominal', () => {
    const path = ['queued', 'preparing', 'running', 'processing', 'completed'] as const;
    for (let i = 1; i < path.length; i++) {
      expect(canTransitionJob(path[i - 1]!, path[i]!)).toBe(true);
    }
  });

  it('ne permet aucune sortie depuis un état terminal', () => {
    for (const status of JOB_STATUSES.filter(isTerminalJobStatus)) {
      expect(JOB_TRANSITIONS[status]).toEqual([]);
    }
  });

  it("permet l'annulation et l'échec depuis tout état non terminal", () => {
    for (const status of JOB_STATUSES.filter((s) => !isTerminalJobStatus(s))) {
      expect(canTransitionJob(status, 'cancelled')).toBe(true);
      expect(canTransitionJob(status, 'failed')).toBe(true);
    }
  });

  it('interdit de sauter des étapes ou de revenir en arrière', () => {
    expect(canTransitionJob('queued', 'completed')).toBe(false);
    expect(canTransitionJob('running', 'queued')).toBe(false);
    expect(canTransitionJob('failed', 'queued')).toBe(false);
  });
});
