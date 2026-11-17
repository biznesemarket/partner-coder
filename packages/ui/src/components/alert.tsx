import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

const Alert = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(function Alert(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role="alert"
      data-slot="alert"
      className={cn("w-full rounded-lg border p-4 text-sm", className)}
      {...props}
    />
  );
});

Alert.displayName = "Alert";

export { Alert };
