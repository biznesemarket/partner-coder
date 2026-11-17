import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

const Skeleton = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(function Skeleton(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
});

Skeleton.displayName = "Skeleton";

export { Skeleton };
