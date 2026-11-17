import http from "node:http";

const MAILPIT_HOST = "localhost";

const MAILPIT_PORT = 8025;

const POLL_INTERVAL_MS = 500;

const REQUEST_TIMEOUT_MS = 5_000;

const DEFAULT_TIMEOUT_MS = 15_000;

const RESET_LINK_PATTERN = /reset-password\?token=([A-Za-z0-9._~%+-]+)/;

type MailpitMessageSummary = {
  ID: string;
  Created: string;
  To?: Array<{ Address: string }>;
};

type MailpitMessagesResponse = {
  messages?: MailpitMessageSummary[];
};

type MailpitMessage = {
  Text?: string;
  HTML?: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getJson<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { host: MAILPIT_HOST, port: MAILPIT_PORT, path, agent: false },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Mailpit ${path}: HTTP ${response.statusCode ?? 0}`));
          return;
        }

        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Mailpit ${path}: timeout`));
    });
    request.on("error", reject);
  });
}

function extractToken(body: string): string | null {
  const match = RESET_LINK_PATTERN.exec(body);
  const token = match?.[1];

  return token ? decodeURIComponent(token) : null;
}

async function messageToken(message: MailpitMessageSummary): Promise<string | null> {
  const detail = await getJson<MailpitMessage>(`/api/v1/message/${message.ID}`);

  return extractToken(`${detail.Text ?? ""}\n${detail.HTML ?? ""}`);
}

/**
 * Токен последней ссылки сброса пароля из Mailpit. Опрашивает API, пока письмо
 * не появится: SMTP-доставка асинхронна по отношению к HTTP-ответу.
 */
export async function latestResetToken(
  email: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const data = await getJson<MailpitMessagesResponse>("/api/v1/messages");
      const messages = (data.messages ?? [])
        .filter((message) =>
          (message.To ?? []).some((recipient) => recipient.Address.toLowerCase() === normalized),
        )
        .sort((left, right) => Date.parse(right.Created) - Date.parse(left.Created));

      for (const message of messages) {
        try {
          const token = await messageToken(message);

          if (token !== null) {
            return token;
          }
        } catch (error) {
          lastError = error;
        }
      }
    } catch (error) {
      lastError = error;
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Mailpit: не найдено письмо со ссылкой сброса для ${email}`,
    lastError === null ? undefined : { cause: lastError },
  );
}
