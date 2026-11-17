import { forwardRef } from "react";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { Label } from "./label";

type FieldProps = {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
};

/**
 * Поле формы. Текст `hint`/`error` получает стабильные id: `${htmlFor}-hint` и
 * `${htmlFor}-error`. Контрол связывается на стороне потребителя:
 * `aria-describedby={error ? `${htmlFor}-error` : `${htmlFor}-hint`}` и `aria-invalid={Boolean(error)}`.
 */
const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { label, htmlFor, hint, error, children, className },
  ref,
) {
  return (
    <div ref={ref} data-slot="field" className={cn("grid gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${htmlFor}-hint`} data-slot="field-hint" className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          data-slot="field-error"
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
});

Field.displayName = "Field";

export { Field };
