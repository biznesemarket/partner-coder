"use client";

import { Button, EmptyState } from "@partner-coder/ui";
import { useRouter } from "next/navigation";

import { messages } from "@/lib/messages";

export function ServiceUnavailable() {
  const router = useRouter();

  return (
    <EmptyState
      title={messages.errors.serviceUnavailable}
      description={messages.errors.serviceUnavailableDescription}
      action={
        <Button type="button" variant="outline" onClick={() => router.refresh()}>
          {messages.common.retry}
        </Button>
      }
    />
  );
}
