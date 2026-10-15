import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  id?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled card that groups related settings rows. */
export function SettingsSection({
  id,
  title,
  description,
  action,
  footer,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-6 rounded-xl border bg-card text-card-foreground shadow-sm",
        className
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-6 py-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold leading-none tracking-tight">
            {title}
          </h2>
          {description && (
            <p className="max-w-prose text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action}
      </header>
      <div className="divide-y">{children}</div>
      {footer && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-6 py-3 text-xs text-muted-foreground">
          {footer}
        </footer>
      )}
    </section>
  );
}

interface SettingRowProps {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** One setting: label and help on the left, control on the right. */
export function SettingRow({
  label,
  htmlFor,
  help,
  children,
  className,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8",
        className
      )}
    >
      <div className="min-w-0 space-y-1 sm:max-w-md">
        <label htmlFor={htmlFor} className="text-sm font-medium leading-none">
          {label}
        </label>
        {help && <p className="text-sm text-muted-foreground">{help}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
