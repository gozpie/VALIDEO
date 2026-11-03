import type { ReactNode } from 'react';

/** État vide explicite : ce qui manque, et l'action pour commencer. */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="max-w-xs text-xs text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
