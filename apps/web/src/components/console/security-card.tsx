"use client";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@partner-coder/ui";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { messages } from "@/lib/messages";

import { PasskeyList } from "./passkey-list";

type SecurityCardProps = {
  twoFactorEnabled: boolean;
  enrolled: boolean;
};

export function SecurityCard({ twoFactorEnabled, enrolled }: SecurityCardProps) {
  const enrolledToastShown = useRef(false);

  useEffect(() => {
    if (!enrolled || enrolledToastShown.current) {
      return;
    }

    enrolledToastShown.current = true;
    toast.success(messages.security.enrolled);
  }, [enrolled]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.security.totpTitle}</CardTitle>
        <CardDescription>{messages.security.totpDescription}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{messages.security.totpStatusLabel}</span>
            <Badge variant={twoFactorEnabled ? "secondary" : "outline"}>
              {twoFactorEnabled ? messages.security.totpEnabled : messages.security.totpDisabled}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{messages.security.totpResetHint}</p>
        </div>
        <Separator />
        <PasskeyList />
      </CardContent>
    </Card>
  );
}
