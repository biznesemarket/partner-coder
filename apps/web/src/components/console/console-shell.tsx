"use client";

import {
  Badge,
  BrandMark,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Spinner,
  ThemeToggle,
} from "@partner-coder/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

import { messages } from "@/lib/messages";
import type { VendorMe } from "@/lib/vendor-types";

import { useSignOut } from "./logout-button";

const NAV_ITEMS = [
  { href: "/clients", label: messages.nav.clients },
  { href: "/plans", label: messages.nav.plans },
  { href: "/me", label: messages.nav.profile },
  { href: "/me/security", label: messages.nav.security },
] as const;

type ConsoleShellProps = {
  me: VendorMe;
  children: ReactNode;
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/me") {
    return pathname === "/me";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }

  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";

  return `${first}${last}`.toUpperCase();
}

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="grid gap-1">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate?.()}
              className={cn(
                "flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function UserMenu({ me }: { me: VendorMe }) {
  const { pending, signOut } = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="min-w-11 gap-2 px-2">
          <span className="sr-only">{messages.common.userMenu}</span>
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
          >
            {initials(me.user.name)}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block max-w-40 truncate text-sm font-medium leading-tight">
              {me.user.name}
            </span>
            <span className="block max-w-40 truncate text-xs font-normal leading-tight text-muted-foreground">
              {me.user.email}
            </span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{me.user.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {me.user.email}
          </span>
        </DropdownMenuLabel>
        <div className="flex flex-wrap gap-1 px-2 pb-1">
          <Badge variant="secondary">{messages.roles[me.user.role]}</Badge>
          <Badge variant="outline">{messages.statuses[me.user.status]}</Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
        >
          {pending ? <Spinner className="h-4 w-4" /> : null}
          {messages.common.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConsoleShell({ me, children }: ConsoleShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a
        href="#console-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow"
      >
        {messages.common.skipToContent}
      </a>
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
          <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-w-11 md:hidden"
                aria-label={messages.common.openMenu}
              >
                <MenuIcon />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xs">
              <DialogHeader>
                <DialogTitle>{messages.common.navigation}</DialogTitle>
                <DialogDescription className="sr-only">
                  {messages.common.consoleNavigation}
                </DialogDescription>
              </DialogHeader>
              <nav aria-label={messages.common.consoleNavigation}>
                <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
              </nav>
            </DialogContent>
          </Dialog>
          <Link href="/me" className="inline-flex items-center rounded-md">
            <BrandMark />
          </Link>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <UserMenu me={me} />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-6">
        <aside className="hidden w-52 shrink-0 md:block">
          <nav aria-label={messages.common.consoleNavigation}>
            <NavLinks pathname={pathname} />
          </nav>
        </aside>
        <main id="console-main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
