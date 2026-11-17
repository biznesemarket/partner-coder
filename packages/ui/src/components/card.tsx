import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/cn";

const Card = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="card"
      className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
});

const CardHeader = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(function CardHeader(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 p-6", className)}
      {...props}
    />
  );
});

const CardTitle = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(function CardTitle(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="card-title"
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
});

const CardDescription = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  function CardDescription({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card-description"
        className={cn("text-sm text-muted-foreground", className)}
        {...props}
      />
    );
  },
);

const CardContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  function CardContent({ className, ...props }, ref) {
    return (
      <div ref={ref} data-slot="card-content" className={cn("p-6 pt-0", className)} {...props} />
    );
  },
);

const CardFooter = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(function CardFooter(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="card-footer"
      className={cn("flex items-center p-6 pt-0", className)}
      {...props}
    />
  );
});

Card.displayName = "Card";
CardHeader.displayName = "CardHeader";
CardTitle.displayName = "CardTitle";
CardDescription.displayName = "CardDescription";
CardContent.displayName = "CardContent";
CardFooter.displayName = "CardFooter";

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
