'use client';

import { useEffect, useId, useState } from 'react';

/** Champ numérique validé à la sortie du champ ou sur Entrée ; Échap rétablit la valeur. */
export function NumberField({
  label,
  value,
  onCommit,
  disabled = false,
  step = 0.1,
  min,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
  step?: number;
  min?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (Number.isFinite(parsed) && (min === undefined || parsed >= min) && parsed !== value)
      onCommit(parsed);
    else setDraft(String(value));
  };
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col text-xs">
      <span className="text-muted">{label}</span>
      <input
        id={id}
        type="number"
        step={step}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraft(String(value));
        }}
        className="w-full rounded border border-border bg-surface px-1.5 py-1 text-sm disabled:opacity-50"
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
