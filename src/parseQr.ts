/** Normalize LoRaWAN hex fields (strip separators, lowercase). */
export function normalizeHex(s: string): string {
  return s.replace(/[\s:.-]/g, "").replace(/^0x/i, "").toLowerCase();
}

export type ParsedCredentials = {
  deveui: string;
  appeui: string;
  appkey: string;
  deviceName?: string;
  serialNumber?: string;
};

function isHex(s: string): boolean {
  return /^[0-9a-f]+$/i.test(s);
}

/** Try JSON: { deveui, appkey, appeui } (keys case-insensitive). */
function tryJson(text: string): ParsedCredentials | null {
  const t = text.trim();
  if (!t.startsWith("{")) return null;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    const keys = Object.keys(o).reduce<Record<string, string>>((acc, k) => {
      acc[k.toLowerCase()] = String(o[k] ?? "");
      return acc;
    }, {});
    const deveui = normalizeHex(keys.deveui ?? keys.dev_eui ?? keys.eui ?? "");
    const appeui = normalizeHex(keys.appeui ?? keys.app_eui ?? keys.join_eui ?? "");
    const appkey = normalizeHex(keys.appkey ?? keys.app_key ?? keys.nwkkey ?? "");
    if (deveui.length === 16 && appkey.length === 32 && appeui.length === 16) {
      return { deveui, appeui, appkey };
    }
    if (deveui.length === 16 && appkey.length === 32 && appeui.length === 0) {
      return { deveui, appeui: "", appkey };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * MultiTech payload example:
 * DevEUI:AppKey:AppEUI:Model:Serial
 * 7894E80000057DEF:BBC7874F37721B429226A6016AE0C50A:7894E80000000000:RBS3010NA01BN00:23412332
 */
function tryMultiTechColonFormat(text: string): ParsedCredentials | null {
  const parts = text
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 4) return null;

  const deveui = normalizeHex(parts[0] ?? "");
  const appkey = normalizeHex(parts[1] ?? "");
  if (deveui.length !== 16 || appkey.length !== 32) {
    return null;
  }

  let appeui = "";
  let deviceName = "";
  let serialNumber = "";

  const third = parts[2] ?? "";
  const normalizedThird = normalizeHex(third);

  if (normalizedThird.length === 16 && isHex(normalizedThird)) {
    appeui = normalizedThird;
    deviceName = parts[3] ?? "";
    serialNumber = parts[4] ?? "";
  } else {
    deviceName = third;
    serialNumber = parts[3] ?? "";
  }

  return {
    deveui,
    appeui,
    appkey,
    deviceName: deviceName || undefined,
    serialNumber: serialNumber || undefined,
  };
}

/**
 * Split payload on common delimiters; supports 2-field (deveui, appkey) or
 * 3-field (deveui, appeui, appkey) comma/pipe/semicolon/newline separated hex.
 */
export function parseQrPayload(raw: string): ParsedCredentials | null {
  const trimmed = raw.trim();
  const fromJson = tryJson(trimmed);
  if (fromJson) return fromJson;

  const fromMultiTech = tryMultiTechColonFormat(trimmed);
  if (fromMultiTech) return fromMultiTech;

  const parts = trimmed
    .split(/[,|;\/\s\n\r\t]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(normalizeHex);

  const hexParts = parts.filter((p) => isHex(p));

  if (hexParts.length === 2) {
    const [a, b] = hexParts;
    if (a.length === 16 && b.length === 32) {
      return { deveui: a, appeui: "", appkey: b };
    }
    if (a.length === 32 && b.length === 16) {
      return { deveui: b, appeui: "", appkey: a };
    }
  }

  if (hexParts.length >= 3) {
    const [d, e, k] = hexParts;
    if (d.length === 16 && e.length === 16 && k.length === 32) {
      return { deveui: d, appeui: e, appkey: k };
    }
  }

  return null;
}
