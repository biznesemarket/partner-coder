import type { CDPSession, Page } from "@playwright/test";

export type VirtualAuthenticator = {
  readonly client: CDPSession;
  readonly authenticatorId: string;
};

/**
 * Подключает к странице CDP-виртуальный аутентификатор WebAuthn. Resident key
 * нужен для входа без email (discoverable credentials), а
 * `automaticPresenceSimulation` избавляет от реального железа и UI-подсказок.
 */
export async function addVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const client = await page.context().newCDPSession(page);

  await client.send("WebAuthn.enable");

  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  return { client, authenticatorId };
}

/** Снимает виртуальный аутентификатор; безопасно вызывать в `finally`. */
export async function removeVirtualAuthenticator(
  authenticator: VirtualAuthenticator,
): Promise<void> {
  await authenticator.client.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: authenticator.authenticatorId,
  });
  await authenticator.client.send("WebAuthn.disable");
}
