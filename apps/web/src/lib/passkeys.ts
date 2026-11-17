const NIL_AAGUID = "00000000-0000-0000-0000-000000000000";

const FALLBACK_LABEL = "Passkey";

/*
 * Небольшой справочник известных аутентификаторов. AAGUID описывает модель
 * устройства, а не конкретный ключ, и платформы с attestation: "none" часто
 * присылают нулевой AAGUID — для них остаётся нейтральная подпись.
 */
const KNOWN_AAGUIDS: Readonly<Record<string, string>> = {
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
};

export type PasskeyLabelSource = {
  name?: string | null | undefined;
  aaguid?: string | null | undefined;
};

export function passkeyLabel(passkey: PasskeyLabelSource): string {
  const name = typeof passkey.name === "string" ? passkey.name.trim() : "";

  if (name !== "") {
    return name;
  }

  const aaguid = typeof passkey.aaguid === "string" ? passkey.aaguid.trim().toLowerCase() : "";

  if (aaguid !== "" && aaguid !== NIL_AAGUID) {
    return KNOWN_AAGUIDS[aaguid] ?? FALLBACK_LABEL;
  }

  return FALLBACK_LABEL;
}
