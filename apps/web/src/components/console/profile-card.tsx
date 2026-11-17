"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@partner-coder/ui";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { messages } from "@/lib/messages";
import type { VendorMe } from "@/lib/vendor-types";

type ProfileCardProps = {
  me: VendorMe;
  enrolled: boolean;
};

export function ProfileCard({ me, enrolled }: ProfileCardProps) {
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
        <CardTitle>{messages.profile.title}</CardTitle>
        <CardDescription>{messages.profile.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {messages.profile.nameLabel}
            </dt>
            <dd className="text-sm">{me.user.name}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {messages.profile.emailLabel}
            </dt>
            <dd className="break-all text-sm">{me.user.email}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {messages.profile.roleLabel}
            </dt>
            <dd className="text-sm">
              <Badge variant="secondary">{messages.roles[me.user.role]}</Badge>
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {messages.profile.statusLabel}
            </dt>
            <dd className="text-sm">
              <Badge variant="outline">{messages.statuses[me.user.status]}</Badge>
            </dd>
          </div>
        </dl>
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" size="sm">
          <Link href="/me/security">{messages.profile.securityLink}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
