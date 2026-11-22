import "@fontsource-variable/inter";

import { Toaster } from "@partner-coder/ui";
import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { messages } from "@/lib/messages";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: messages.metadata.titleDefault,
    template: messages.metadata.titleTemplate,
  },
  description: messages.metadata.description,
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#15181d" },
  ],
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function RootLayout({ children }: RootLayoutProps) {
  await connection();

  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
