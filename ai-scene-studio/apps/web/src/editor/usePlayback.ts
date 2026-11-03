'use client';

import { useEffect } from 'react';
import { useEditorContext } from './context';

/**
 * Lecture temps réel : la frame affichée est déduite du temps écoulé et de la cadence rationnelle
 * (frame = départ + ⌊t × num / den⌋). Le navigateur peut sauter des images, jamais en inventer : l'état
 * affiché est toujours celui d'une frame entière évaluée exactement.
 */
export function usePlayback() {
  const { store } = useEditorContext();
  useEffect(() => {
    let raf = 0;
    let origin: { time: number; frame: number } | null = null;
    const tick = (time: number) => {
      const state = store.getState();
      if (!state.playing) {
        origin = null;
      } else {
        const { numerator, denominator } = state.scene.fps;
        const duration = state.scene.durationFrames;
        if (!origin) origin = { time, frame: state.frame >= duration - 1 ? 0 : state.frame };
        let frame =
          origin.frame + Math.floor(((time - origin.time) / 1000) * (numerator / denominator));
        if (frame >= duration) {
          if (state.loop) {
            frame %= duration;
          } else {
            frame = duration - 1;
            state.setPlaying(false);
          }
        }
        if (frame !== state.frame) state.setFrame(frame);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [store]);
}
