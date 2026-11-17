const DEFAULT_RETURN_TO = "/me";

const BASE_ORIGIN = "http://local";

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return DEFAULT_RETURN_TO;
  }

  const candidate = value.trim();
  if (candidate === "") {
    return DEFAULT_RETURN_TO;
  }

  if (candidate.includes("\\") || candidate.includes("?") || candidate.includes("#")) {
    return DEFAULT_RETURN_TO;
  }

  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return DEFAULT_RETURN_TO;
  }

  try {
    const url = new URL(candidate, BASE_ORIGIN);
    if (url.origin !== BASE_ORIGIN) {
      return DEFAULT_RETURN_TO;
    }

    if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) {
      return DEFAULT_RETURN_TO;
    }

    return url.pathname;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}
