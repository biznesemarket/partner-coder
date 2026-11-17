import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

const Spinner = forwardRef<SVGSVGElement, ComponentPropsWithoutRef<"svg">>(function Spinner(
  { className, ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      data-slot="spinner"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("size-4 animate-spin", className)}
      {...props}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
});

Spinner.displayName = "Spinner";

export { Spinner };
