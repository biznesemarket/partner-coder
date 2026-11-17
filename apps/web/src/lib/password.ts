import { messages } from "./messages";

export const PASSWORD_MIN_LENGTH = 12;

export function passwordError(password: string, minLength: number): string | null {
  if (password.length < minLength) {
    return messages.auth.passwordTooShort(minLength);
  }

  return null;
}

export function passwordsMatchError(password: string, confirm: string): string | null {
  if (password !== confirm) {
    return messages.auth.passwordsMismatch;
  }

  return null;
}
