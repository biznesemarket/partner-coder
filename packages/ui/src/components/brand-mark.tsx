import { cn } from "../lib/cn";

type BrandMarkProps = {
  className?: string;
  showName?: boolean;
};

function BrandMark({ className, showName = true }: BrandMarkProps) {
  return (
    <span
      data-slot="brand-mark"
      className={cn("inline-flex items-center gap-2 text-foreground", className)}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
      >
        ПК
      </span>
      {showName ? (
        <span className="text-base font-semibold tracking-tight">Партнер кодер</span>
      ) : (
        <span className="sr-only">Партнер кодер</span>
      )}
    </span>
  );
}

BrandMark.displayName = "BrandMark";

export { BrandMark };
