"use client";

import { useTheme } from "next-themes";
import { Toaster as SonnerToaster } from "sonner";
import type { ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  const theme: ToasterProps["theme"] =
    resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "system";

  return <SonnerToaster {...props} theme={theme} />;
}

Toaster.displayName = "Toaster";

export { Toaster };
