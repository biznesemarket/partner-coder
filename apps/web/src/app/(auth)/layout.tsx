import { BrandMark, ThemeToggle } from "@partner-coder/ui";
import type { ReactNode } from "react";

import { messages } from "@/lib/messages";

type AuthLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/30 px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <header className="flex flex-col items-center gap-2">
        <BrandMark />
        <p className="text-sm text-muted-foreground">{messages.common.console}</p>
      </header>
      <main id="auth-main" className="w-full max-w-md">
        {children}
      </main>
    </div>
  );
}
