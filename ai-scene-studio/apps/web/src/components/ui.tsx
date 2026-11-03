import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-accent font-semibold text-white shadow-card hover:bg-accent-strong',
    secondary: 'border border-border bg-elevated text-text hover:border-border-strong',
    danger: 'border border-border text-error hover:border-error hover:bg-error/10',
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-[13px]">
      <span className="font-medium text-muted">{label}</span>
      <input
        id={id}
        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none"
        {...props}
      />
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-error">
      {children}
    </p>
  );
}

export function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-panel p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
