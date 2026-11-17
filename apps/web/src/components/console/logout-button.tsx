"use client";

import { Button, Spinner } from "@partner-coder/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { messages } from "@/lib/messages";

type LogoutButtonProps = {
  className?: string;
};

export function LogoutButton({ className }: LogoutButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await authClient.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className={className}
      onClick={handleLogout}
      disabled={pending}
    >
      {pending ? <Spinner className="h-4 w-4" /> : null}
      {messages.common.logout}
    </Button>
  );
}
