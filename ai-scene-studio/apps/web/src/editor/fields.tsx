'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { evaluateExpression, tidy } from '@/lib/expression';
import { useOptionalEditorContext } from './context';

/**
 * Champ numérique : saisie d'une valeur ou d'une expression (« 2*1.5 », « 90/4 »), validée à la
 * sortie du champ ou sur Entrée ; Échap rétablit la valeur. Glisser l'étiquette horizontalement
 * fait varier la valeur (Maj : précis ×0,1, Alt : rapide ×10) ; dans l'éditeur, tout le glissé
 * forme une seule étape d'annulation.
 */
export function NumberField({
  label,
  value,
  onCommit,
  disabled = false,
  step = 0.1,
  min,
  max,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
  step?: number;
  min?: number;
  max?: number;
}) {
  const id = useId();
  const editor = useOptionalEditorContext();
  const [draft, setDraft] = useState(String(value));
  const [scrubbing, setScrubbing] = useState(false);
  const last = useRef(value);
  // Après un glissé, le clic qui suit ne doit pas donner le focus au champ (raccourcis actifs).
  const dragged = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = () => {
    const parsed = evaluateExpression(draft);
    const valid =
      parsed !== null &&
      (min === undefined || parsed >= min) &&
      (max === undefined || parsed <= max);
    if (valid && parsed !== value) onCommit(tidy(parsed));
    else setDraft(String(value));
  };
  const integer = Number.isInteger(step);
  return (
    <label
      htmlFor={id}
      className="flex min-w-0 flex-col text-xs"
      onClick={(event) => {
        if (dragged.current) event.preventDefault();
        dragged.current = false;
      }}
    >
      <span
        className={`select-none text-muted ${disabled ? '' : 'cursor-ew-resize hover:text-text'} ${scrubbing ? 'text-accent-strong' : ''}`}
        title={disabled ? undefined : 'Glisser pour ajuster (Maj : précis, Alt : rapide)'}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.preventDefault();
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          const startX = event.clientX;
          const startValue = value;
          last.current = value;
          let moved = false;
          dragged.current = false;
          const onMove = (move: PointerEvent) => {
            const dx = move.clientX - startX;
            if (!moved && Math.abs(dx) < 3) return;
            if (!moved) {
              moved = true;
              dragged.current = true;
              setScrubbing(true);
              editor?.store.getState().beginGesture();
            }
            const factor = move.shiftKey ? 0.1 : move.altKey ? 10 : 1;
            const raw = startValue + Math.round(dx / 4) * step * factor;
            const next = clamp(integer && factor >= 1 ? Math.round(raw) : tidy(raw));
            if (next === last.current) return;
            last.current = next;
            setDraft(String(next));
            onCommit(next);
          };
          const onUp = () => {
            target.removeEventListener('pointermove', onMove);
            target.removeEventListener('pointerup', onUp);
            target.removeEventListener('pointercancel', onUp);
            if (moved) editor?.store.getState().endGesture();
            setScrubbing(false);
          };
          target.addEventListener('pointermove', onMove);
          target.addEventListener('pointerup', onUp);
          target.addEventListener('pointercancel', onUp);
        }}
      >
        {label}
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraft(String(value));
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const factor = event.shiftKey ? 0.1 : event.altKey ? 10 : 1;
            const next = clamp(tidy(value + (event.key === 'ArrowUp' ? 1 : -1) * step * factor));
            if (next !== value) onCommit(next);
          }
        }}
        className={`w-full rounded-md border bg-surface px-1.5 py-1 font-mono text-[13px] tabular-nums transition-colors hover:border-border-strong focus:border-accent focus:outline-none disabled:opacity-50 ${scrubbing ? 'border-accent' : 'border-border'}`}
      />
    </label>
  );
}

export function Vec3Field({
  label,
  value,
  onCommit,
  disabled,
  step,
}: {
  label: string;
  value: readonly [number, number, number];
  onCommit: (value: [number, number, number]) => void;
  disabled?: boolean;
  step?: number;
}) {
  return (
    <fieldset className="flex flex-col gap-1" disabled={disabled}>
      <legend className="mb-1 text-xs font-semibold text-muted">{label}</legend>
      <div className="grid grid-cols-3 gap-1">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <NumberField
            key={axis}
            label={`${label} ${axis}`}
            value={value[index] ?? 0}
            step={step ?? 0.1}
            disabled={disabled ?? false}
            onCommit={(component) => {
              const next: [number, number, number] = [value[0], value[1], value[2]];
              next[index] = component;
              onCommit(next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}
