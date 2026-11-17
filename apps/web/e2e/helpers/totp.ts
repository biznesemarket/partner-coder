import * as OTPAuth from "otpauth";

function parseTotpUri(uri: string): OTPAuth.TOTP {
  const otp = OTPAuth.URI.parse(uri);

  if (!(otp instanceof OTPAuth.TOTP)) {
    throw new Error("Ожидался TOTP URI, получен HOTP");
  }

  return otp;
}

/** Текущий TOTP-код из `otpauth://` URI, полученного от `two-factor/enable`. */
export function totpFromUri(uri: string): string {
  return parseTotpUri(uri).generate();
}

/** Миллисекунды до смены текущего кода: нужны, чтобы не отправить протухший код. */
export function totpRemainingMs(uri: string): number {
  return parseTotpUri(uri).remaining();
}
