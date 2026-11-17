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

const MAX_BODY_BYTES = 64 * 1024;

const MAX_QUERY_BYTES = 8 * 1024;

const UPSTREAM_TIMEOUT_MS = 15_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ProxyVendorRequestOptions = {
  apiBaseUrl: string;
  targetPathPrefix: string;
  fetchImpl?: FetchLike;
  expectedOrigin?: string;
};

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

function buildForwardHeaders(request: Request, requestId: string): Headers {
  const headers = new Headers();

  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }

  headers.set("x-request-id", requestId);
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
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  if (!hasValidPath(pathSegments)) {
    return jsonError(400, "invalid_path", "Некорректный путь запроса", requestId);
  }

  const { search } = new URL(request.url);
  if (Buffer.byteLength(search, "utf8") > MAX_QUERY_BYTES) {
    return jsonError(414, "query_too_long", "Слишком длинная строка запроса", requestId);
  }

  const method = request.method.toUpperCase();
  const requestOrigin = request.headers.get("origin");

  if (requestOrigin !== null && isUnsafeMethod(method)) {
    const expectedOrigin = normalizeOrigin(
      options.expectedOrigin ?? process.env.VENDOR_BASE_URL ?? new URL(request.url).origin,
    );

    if (normalizeOrigin(requestOrigin) !== expectedOrigin) {
      return jsonError(403, "origin_forbidden", "Запрос отклонён", requestId);
    }
  }

  if (declaredBodyTooLarge(request)) {
    return jsonError(413, "payload_too_large", "Слишком большое тело запроса", requestId);
  }

  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return jsonError(413, "payload_too_large", "Слишком большое тело запроса", requestId);
    }
  }

  const target = buildTargetUrl(options.apiBaseUrl, options.targetPathPrefix, pathSegments, search);

  const init: RequestInit = {
    method,
    headers: buildForwardHeaders(request, requestId),
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
    return jsonError(502, "upstream_unavailable", "Сервис временно недоступен", requestId);
  }

  return buildResponse(upstream, requestId);
}
