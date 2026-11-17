import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@partner-coder/ui";

import { formatDateTime } from "@/lib/format";
import { messages } from "@/lib/messages";

import { LogoutButton } from "./logout-button";

type SessionCardProps = {
  sessionExpiresAt: string;
  stepUpUntil: string | null;
};

export function SessionCard({ sessionExpiresAt, stepUpUntil }: SessionCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{messages.session.title}</CardTitle>
        <CardDescription>{messages.session.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {messages.session.expiresLabel}
            </dt>
            <dd className="text-sm">
              <time dateTime={sessionExpiresAt}>{formatDateTime(sessionExpiresAt)}</time>
            </dd>
          </div>
          {stepUpUntil !== null ? (
            <div className="grid gap-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {messages.session.stepUpLabel}
              </dt>
              <dd className="text-sm">
                <time dateTime={stepUpUntil}>{formatDateTime(stepUpUntil)}</time>
              </dd>
            </div>
          ) : null}
        </dl>
        {stepUpUntil !== null ? (
          <p className="text-xs text-muted-foreground">{messages.session.stepUpHint}</p>
        ) : null}
        <div>
          <LogoutButton />
        </div>
      </CardContent>
    </Card>
  );
}
