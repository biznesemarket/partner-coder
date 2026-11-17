"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>;

function ThemeProvider(props: ThemeProviderProps) {
  return <NextThemesProvider {...props} />;
}

ThemeProvider.displayName = "ThemeProvider";

export { ThemeProvider };
