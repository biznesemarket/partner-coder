import { mapAuthError } from "@/lib/errors";

export type ConsoleAuthError = {
  code?: string | null | undefined;
  status?: number | null | undefined;
  statusCode?: number | null | undefined;
};

export type ConsoleRouter = {
  replace(href: string): void;
  refresh(): void;
};

function errorStatus(error: ConsoleAuthError): number | null {
  if (typeof error.status === "number") {
    return error.status;
  }

  if (typeof error.statusCode === "number") {
    return error.statusCode;
  }

  return null;
}

function errorCode(error: ConsoleAuthError): string | null {
  if (typeof error.code === "string") {
    return error.code;
  }

  if (!("error" in error)) {
    return null;
  }

  const nested = (error as { error?: unknown }).error;

  if (typeof nested !== "object" || nested === null || !("code" in nested)) {
    return null;
  }

  const code = (nested as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Переводит ошибку защищённого действия в навигацию или в текст для формы.
 * `null` означает, что пользователя уже перенаправили.
 */
export function handleConsoleAuthError(
  error: ConsoleAuthError,
  router: ConsoleRouter,
  pathname: string,
): string | null {
  const status = errorStatus(error);
  const code = errorCode(error);

  if (status === 401) {
    router.replace(`/login?reason=session_expired&returnTo=${encodeURIComponent(pathname)}`);
    router.refresh();
    return null;
  }

  if (status === 403 && code === "vendor_mfa_required") {
    router.replace(`/setup-mfa?returnTo=${encodeURIComponent(pathname)}`);
    router.refresh();
    return null;
  }

  if (status === 403 && code === "vendor_inactive") {
    router.replace("/login?reason=inactive");
    router.refresh();
    return null;
  }

  return mapAuthError(error);
}
