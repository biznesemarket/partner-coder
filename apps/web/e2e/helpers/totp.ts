import * as OTPAuth from "otpauth";

/** Текущий TOTP-код из `otpauth://` URI, полученного от `two-factor/enable`. */
export function totpFromUri(uri: string): string {
  const otp = OTPAuth.URI.parse(uri);

  if (!(otp instanceof OTPAuth.TOTP)) {
    throw new Error("Ожидался TOTP URI, получен HOTP");
  }

  return otp.generate();
}
