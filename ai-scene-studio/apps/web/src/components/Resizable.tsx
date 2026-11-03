'use client';

import { useCallback, useEffect, useState } from 'react';

/** Taille d'un panneau en pixels, bornée et mémorisée dans le navigateur. */
export function useResizable(
  key: string,
  initial: number,
  min: number,
  max: number,
): [number, (size: number) => void] {
  const storageKey = `ass.layout.${key}`;
  const [size, setSize] = useState(initial);
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored >= min && stored <= max) setSize(stored);
  }, [storageKey, min, max]);
  const update = useCallback(
    (value: number) => {
      const clamped = Math.round(Math.min(max, Math.max(min, value)));
      setSize(clamped);
      window.localStorage.setItem(storageKey, String(clamped));
    },
    [storageKey, min, max],
  );
  return [size, update];
}

/**
 * Poignée de redimensionnement entre deux panneaux. `direction` : +1 si tirer vers la droite / le bas
 * agrandit le panneau, −1 sinon. Double-clic : taille par défaut. Flèches au clavier (pas de 16 px).
 */
export function ResizeHandle({
  label,
  orientation,
  size,
  direction,
  onResize,
  defaultSize,
}: {
  label: string;
  orientation: 'vertical' | 'horizontal';
  size: number;
  direction: 1 | -1;
  onResize: (size: number) => void;
  defaultSize: number;
}) {
  const vertical = orientation === 'vertical';
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={size}
      tabIndex={0}
      className={`group relative z-10 shrink-0 ${vertical ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'} bg-border outline-none hover:bg-accent focus-visible:bg-accent`}
      onPointerDown={(event) => {
        event.preventDefault();
        const start = vertical ? event.clientX : event.clientY;
        const startSize = size;
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        const onMove = (move: PointerEvent) =>
          onResize(startSize + ((vertical ? move.clientX : move.clientY) - start) * direction);
        const onUp = () => {
          target.removeEventListener('pointermove', onMove);
          target.removeEventListener('pointerup', onUp);
          document.body.style.cursor = '';
        };
        document.body.style.cursor = vertical ? 'col-resize' : 'row-resize';
        target.addEventListener('pointermove', onMove);
        target.addEventListener('pointerup', onUp);
      }}
      onDoubleClick={() => onResize(defaultSize)}
      onKeyDown={(event) => {
        const grow = vertical ? 'ArrowRight' : 'ArrowDown';
        const shrink = vertical ? 'ArrowLeft' : 'ArrowUp';
        if (event.key !== grow && event.key !== shrink) return;
        event.preventDefault();
        event.stopPropagation();
        onResize(size + (event.key === grow ? 16 : -16) * direction);
      }}
    >
      {/* Zone de saisie élargie, invisible. */}
      <span
        className={`absolute ${vertical ? '-left-1 -right-1 inset-y-0' : '-top-1 -bottom-1 inset-x-0'}`}
      />
    </div>
  );
}
