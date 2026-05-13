export type GatewayScheme = "http" | "https";

const RECENT_KEY = "addSensorRecentGateways";
const RECENT_MAX = 8;

/**
 * Resolves what the user typed into a fetch base URL.
 * - `proxy` → Vite dev proxy prefix (when configured).
 * - Values that already include `http://` or `https://` are used as-is (trailing slash trimmed).
 * - Bare IPv4, IPv6 in brackets, hostname, or host:port get the chosen scheme prefix.
 */
export function resolveGatewayBase(input: string, scheme: GatewayScheme): string {
  const t = input.trim();
  if (!t) return "";
  if (/^proxy$/i.test(t)) return "/__gateway__";
  if (/^https?:\/\//i.test(t)) return t.replace(/\/$/, "");
  return `${scheme}://${t}`.replace(/\/$/, "");
}

export function loadRecentGateways(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function rememberGateway(resolvedUrl: string): void {
  if (typeof localStorage === "undefined") return;
  const u = resolvedUrl.trim();
  if (!u || u === "/__gateway__") return;
  const prev = loadRecentGateways();
  const next = [u, ...prev.filter((x) => x !== u)].slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}
