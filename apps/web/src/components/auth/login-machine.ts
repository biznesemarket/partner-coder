export type TotpStep = {
  kind: "totp";
  returnTo: string;
  useBackupCode: boolean;
};

export type ResolveStep = {
  kind: "resolve";
  returnTo: string;
};

export type SecondFactorStep =
  { kind: "enroll"; returnTo: string } | { kind: "done"; returnTo: string };

function hasTwoFactorRedirect(result: unknown): boolean {
  if (typeof result !== "object" || result === null) {
    return false;
  }

  return "twoFactorRedirect" in result && result.twoFactorRedirect === true;
}

/**
 * Решает следующий шаг после успешного входа по паролю. Если Better Auth
 * требует второй фактор, показываем TOTP. Иначе нужно запросить `me`, чтобы
 * узнать, обязательна ли настройка MFA, и вызвать `afterSecondFactor`.
 */
export function afterPassword(result: unknown, returnTo: string): TotpStep | ResolveStep {
  if (hasTwoFactorRedirect(result)) {
    return { kind: "totp", returnTo, useBackupCode: false };
  }

  return { kind: "resolve", returnTo };
}

/**
 * Завершает вход после проверки второго фактора: при обязательной настройке
 * MFA отправляет на enroll, иначе — на исходный безопасный маршрут.
 */
export function afterSecondFactor(
  returnTo: string,
  mfaEnrollmentRequired: boolean,
): SecondFactorStep {
  return mfaEnrollmentRequired ? { kind: "enroll", returnTo } : { kind: "done", returnTo };
}
