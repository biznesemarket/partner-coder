"use client";

import { Button, Spinner } from "@partner-coder/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { messages } from "@/lib/messages";

type LogoutButtonProps = {
  className?: string;
};

export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut(): Promise<boolean> {
    if (pending) {
      return false;
    }

    setPending(true);

    try {
      const { error } = await authClient.signOut();
      if (error) {
        toast.error(messages.errors.signOutFailed);
        return false;
      }

      router.replace("/login");
      router.refresh();
      return true;
    } catch {
      toast.error(messages.errors.signOutFailed);
      return false;
    } finally {
      setPending(false);
    }
  }

  return { pending, signOut };
}

export function LogoutButton({ className }: LogoutButtonProps) {
  const { pending, signOut } = useSignOut();

  return (
    <Button
      type="button"
      variant="ghost"
      className={className}
      onClick={() => void signOut()}
      disabled={pending}
    >
      {pending ? <Spinner className="h-4 w-4" /> : null}
      {messages.common.logout}
    </Button>
  );
}
