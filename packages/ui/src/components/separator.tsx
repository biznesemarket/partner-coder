import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ComponentRef } from "react";

import { cn } from "../lib/cn";

type SeparatorProps = ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>;

const Separator = forwardRef<ComponentRef<typeof SeparatorPrimitive.Root>, SeparatorProps>(
  function Separator({ className, orientation = "horizontal", decorative = true, ...props }, ref) {
    return (
      <SeparatorPrimitive.Root
        ref={ref}
        data-slot="separator"
        decorative={decorative}
        orientation={orientation}
        className={cn(
          "shrink-0 bg-border",
          orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
          className,
        )}
        {...props}
      />
    );
  },
);

Separator.displayName = "Separator";

export { Separator };
