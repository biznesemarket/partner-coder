export type TotpUriParts = {
  secret: string;
  issuer: string | null;
  account: string | null;
};

const EMPTY_PARTS: TotpUriParts = { secret: "", issuer: null, account: null };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Извлекает секрет, издателя и аккаунт из `otpauth://totp/...` URI.
 * Некорректный или чужой URI не бросает исключение: возвращаются пустые части.
 */
export function parseTotpUri(uri: string): TotpUriParts {
  let url: URL;

  try {
    url = new URL(uri);
  } catch {
    return { ...EMPTY_PARTS };
  }

  if (url.protocol !== "otpauth:" || url.host !== "totp") {
    return { ...EMPTY_PARTS };
  }

  const secret = url.searchParams.get("secret") ?? "";
  const issuerParam = url.searchParams.get("issuer");
  const rawLabel = url.pathname.replace(/^\/+/, "");

  const separatorIndex = rawLabel.indexOf(":");
  const rawIssuer = separatorIndex > 0 ? rawLabel.slice(0, separatorIndex) : null;
  const rawAccount = separatorIndex >= 0 ? rawLabel.slice(separatorIndex + 1) : rawLabel;
  const labelIssuer = rawIssuer === null ? null : safeDecode(rawIssuer);
  const labelAccount = safeDecode(rawAccount);

  const issuer =
    issuerParam !== null && issuerParam !== ""
      ? issuerParam
      : labelIssuer !== null && labelIssuer !== ""
        ? labelIssuer
        : null;
  const account = labelAccount !== "" ? labelAccount : null;

  return { secret, issuer, account };
}
