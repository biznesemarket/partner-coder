import {
  normalizeClientIp,
  signClientIp,
  TRUSTED_CLIENT_IP_HEADER,
  TRUSTED_CLIENT_IP_SIGNATURE_HEADER,
} from "@partner-coder/domain";

const FORWARD_HEADERS = [
  "cookie",
  "content-type",
  "accept",
  "origin",
  "user-agent",
  "x-request-id",
  "idempotency-key",
] as const;

const RESPONSE_HEADERS = ["content-type", "content-disposition", "x-request-id"] as const;

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

const MAX_BODY_BYTES = 64 * 1024;

const MAX_QUERY_BYTES = 8 * 1024;

const UPSTREAM_TIMEOUT_MS = Number(process.env.PROXY_UPSTREAM_TIMEOUT_MS ?? 30_000);

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Куда BFF пишет единственную безопасную строку лога; в тестах подменяется. */
export type ProxyLogger = (line: string) => void;

export type ProxyVendorRequestOptions = {
  apiBaseUrl: string;
  targetPathPrefix: string;
  fetchImpl?: FetchLike;
  expectedOrigin?: string;
  logger?: ProxyLogger;
  trustedClientIpSecret?: string;
  clientIpSourceHeader?: string;
};

function defaultLogger(line: string): void {
  console.info(line);
}

function readRequestId(request: Request): string {
  const incoming = request.headers.get("x-request-id");
  if (incoming !== null && REQUEST_ID_PATTERN.test(incoming)) {
    return incoming;
  }

  return crypto.randomUUID();
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  requestId: string = crypto.randomUUID(),
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-request-id": requestId,
    },
  });
}

function hasValidPath(pathSegments: readonly string[]): boolean {
  if (pathSegments.length === 0) {
    return false;
  }

  return pathSegments.every(
    (segment) => segment !== "." && segment !== ".." && SEGMENT_PATTERN.test(segment),
  );
}

function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method);
}

function normalizeOrigin(value: string): string {
  return value.replace(/\/+$/, "");
}

function declaredBodyTooLarge(request: Request): boolean {
  const declared = request.headers.get("content-length");
  if (declared === null) {
    return false;
  }

  const length = Number.parseInt(declared, 10);
  return Number.isFinite(length) && length > MAX_BODY_BYTES;
}

type BodyReadResult =
  { ok: true; body: ArrayBuffer } | { ok: false; reason: "too_large" | "read_error" };

async function readBodyWithLimit(request: Request): Promise<BodyReadResult> {
  if (request.body === null) {
    return { ok: true, body: new ArrayBuffer(0) };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }

      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }

      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason: "read_error" };
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, body: body.buffer as ArrayBuffer };
}

function buildTargetUrl(
  apiBaseUrl: string,
  targetPathPrefix: string,
  pathSegments: readonly string[],
  search: string,
): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const prefix = targetPathPrefix.startsWith("/") ? targetPathPrefix : `/${targetPathPrefix}`;
  return `${base}${prefix}/${pathSegments.join("/")}${search}`;
}

function buildForwardHeaders(
  request: Request,
  requestId: string,
  options: ProxyVendorRequestOptions,
): Headers {
  const headers = new Headers();

  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }

  headers.set("x-request-id", requestId);

  if (options.trustedClientIpSecret) {
    const ip = normalizeClientIp(
      request.headers.get(options.clientIpSourceHeader?.trim() || "x-forwarded-for"),
    );
    if (ip !== null) {
      headers.set(TRUSTED_CLIENT_IP_HEADER, ip);
      headers.set(
        TRUSTED_CLIENT_IP_SIGNATURE_HEADER,
        signClientIp(options.trustedClientIpSecret, ip),
      );
    }
  }

  return headers;
}

function buildResponse(upstream: Response, requestId: string): Response {
  const headers = new Headers();

  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }

  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }

  headers.set("cache-control", "no-store");
  if (!headers.has("x-request-id")) {
    headers.set("x-request-id", requestId);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function proxyVendorRequest(
  request: Request,
  pathSegments: readonly string[],
  options: ProxyVendorRequestOptions,
): Promise<Response> {
  const startedAt = Date.now();
  const requestId = readRequestId(request);
  const log = options.logger ?? defaultLogger;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  const respond = (response: Response): Response => {
    log(
      `bff method=${method} path=${url.pathname} status=${response.status} requestId=${requestId} durationMs=${Date.now() - startedAt}`,
    );
    return response;
  };

  if (!hasValidPath(pathSegments)) {
    return respond(jsonError(400, "invalid_path", "Некорректный путь запроса", requestId));
  }

  const { search } = url;
  if (Buffer.byteLength(search, "utf8") > MAX_QUERY_BYTES) {
    return respond(jsonError(414, "query_too_long", "Слишком длинная строка запроса", requestId));
  }

  const requestOrigin = request.headers.get("origin");

  if (requestOrigin !== null && isUnsafeMethod(method)) {
    const expectedOrigin = normalizeOrigin(
      options.expectedOrigin ?? process.env.VENDOR_BASE_URL ?? new URL(request.url).origin,
    );

    if (normalizeOrigin(requestOrigin) !== expectedOrigin) {
      return respond(jsonError(403, "origin_forbidden", "Запрос отклонён", requestId));
    }
  }

  if (declaredBodyTooLarge(request)) {
    return respond(jsonError(413, "payload_too_large", "Слишком большое тело запроса", requestId));
  }

  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const result = await readBodyWithLimit(request);
    if (!result.ok) {
      if (result.reason === "too_large") {
        return respond(
          jsonError(413, "payload_too_large", "Слишком большое тело запроса", requestId),
        );
      }

      return respond(
        jsonError(400, "invalid_body", "Не удалось прочитать тело запроса", requestId),
      );
    }

    body = result.body;
  }

  const target = buildTargetUrl(options.apiBaseUrl, options.targetPathPrefix, pathSegments, search);

  const init: RequestInit = {
    method,
    headers: buildForwardHeaders(request, requestId, options),
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: "no-store",
  };

  if (body !== undefined) {
    init.body = body;
  }

  let upstream: Response;
  try {
    upstream = await (options.fetchImpl ?? fetch)(target, init);
  } catch {
    return respond(jsonError(502, "upstream_unavailable", "Сервис временно недоступен", requestId));
  }

  return respond(buildResponse(upstream, requestId));
}
