import { gatewayFetch } from "./gatewayFetch";
import { isNativeApp } from "./platform";

export type GatewayCredentials = { username: string; password: string };
export type GatewaySession = { token?: string };
export type GatewayWhoAmI = {
  address?: string;
  permission?: string;
  token?: string;
  user?: string;
};

function jsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

function commandHeaders(): HeadersInit {
  return {};
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

async function readError(res: { text: () => Promise<string>; status: number; statusText?: string }): Promise<string> {
  const t = await res.text();
  try {
    const j = JSON.parse(t) as {
      message?: string;
      error?: string;
      status?: string;
      result?: { message?: string; error?: string };
    };
    return j.message || j.error || j.result?.message || j.result?.error || t || `HTTP ${res.status}`;
  } catch {
    return t || `HTTP ${res.status}`;
  }
}

function withToken(path: string, token?: string): string {
  if (!token) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}token=${encodeURIComponent(token)}`;
}

function withCredentials(path: string, credentials?: GatewayCredentials): string {
  if (!credentials) return path;
  const params = new URLSearchParams({
    username: credentials.username,
    password: credentials.password,
  });
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${params.toString()}`;
}

export function getConfiguredProxyBaseUrl(): string {
  try {
    return localStorage.getItem("gatewayProxyBaseUrl")?.trim().replace(/\/$/, "") || "";
  } catch {
    return "";
  }
}

export function shouldUseGatewayProxy(): boolean {
  if (isNativeApp()) return false;
  if (import.meta.env.DEV) return true;
  if (window.__APP_RUNTIME_CONFIG__?.useGatewayProxy) return true;
  return Boolean(getConfiguredProxyBaseUrl());
}

export function usesBuiltInGatewayProxy(): boolean {
  if (isNativeApp()) return false;
  return import.meta.env.DEV || Boolean(window.__APP_RUNTIME_CONFIG__?.useGatewayProxy);
}

export { isNativeApp } from "./platform";

export function isDirectBrowserGatewayMode(): boolean {
  return !shouldUseGatewayProxy();
}

function getProxyAccessKey(): string {
  try {
    return localStorage.getItem("proxyAccessKey")?.trim() || "";
  } catch {
    return "";
  }
}

function buildRequest(base: string, path: string, headers: HeadersInit): { url: string; headers: HeadersInit } {
  if (shouldUseGatewayProxy() && /^https?:\/\//i.test(base)) {
    const proxyAccessKey = getProxyAccessKey();
    const proxyPrefix = usesBuiltInGatewayProxy() ? "" : getConfiguredProxyBaseUrl();
    return {
      url: `${proxyPrefix}/__gateway__${path}`,
      headers: {
        ...headers,
        "X-Gateway-Target": base,
        ...(proxyAccessKey ? { "X-Proxy-Access-Key": proxyAccessKey } : {}),
      },
    };
  }

  return {
    url: joinUrl(base, path),
    headers,
  };
}

export function describeGatewayError(error: unknown): string {
  if (error instanceof Error && /another ip address/i.test(error.message)) {
    return `${error.message} Use "Disconnect gateway" to clear the existing API session, then try again.`;
  }

  if (error instanceof Error && /(cors|access-control)/i.test(error.message)) {
    return (
      "The browser blocked the gateway request because of CORS. " +
      "Run the local proxy on a PC on the same network as the gateway, enter its URL in Connect to gateway, " +
      "and try again."
    );
  }

  if (isNativeApp() && error instanceof Error && /(certificate|ssl|trust|secure connection)/i.test(error.message)) {
    return (
      "Could not verify the gateway HTTPS certificate. Confirm you are on the same network as the gateway " +
      "and the gateway address is correct."
    );
  }

  if (error instanceof TypeError && /fetch/i.test(error.message) && isDirectBrowserGatewayMode()) {
    return (
      "The browser blocked the gateway request (often CORS or an untrusted HTTPS certificate). " +
      "From the hosted app, use the local proxy URL. From direct HTTPS mode, open the gateway in this browser first to trust the certificate."
    );
  }

  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return isNativeApp()
      ? "Failed to reach the gateway. Check the address, HTTPS setting, and that this device is on the same network as the gateway."
      : "Failed to reach the gateway. Check the address, HTTPS setting, proxy URL, and that the gateway is reachable from this PC.";
  }

  return error instanceof Error ? error.message : String(error);
}

export async function probeGateway(base: string): Promise<number> {
  const request = buildRequest(base, "/api/login", commandHeaders());
  const res = await gatewayFetch(request.url, {
    method: "GET",
    headers: request.headers,
  });
  return res.status;
}

export async function createGatewaySession(
  base: string,
  credentials?: GatewayCredentials,
): Promise<GatewaySession> {
  if (!credentials) {
    return {};
  }

  const params = new URLSearchParams({
    username: credentials.username,
    password: credentials.password,
  });

  const request = buildRequest(base, `/api/login?${params.toString()}`, commandHeaders());
  const res = await gatewayFetch(request.url, {
    method: "GET",
    headers: request.headers,
  });
  if (!res.ok) throw new Error(await readError(res));

  const payload = (await res.json()) as {
    result?: { token?: string };
    status?: string;
    message?: string;
    error?: string;
  };
  const token = payload.result?.token?.replace(/\s+/g, "");
  if (!token) {
    throw new Error("Gateway login succeeded but no token was returned.");
  }

  return { token };
}

export async function getWhoAmI(
  base: string,
  session: GatewaySession,
): Promise<GatewayWhoAmI> {
  if (!session.token) {
    throw new Error("No gateway token is available for the whoami check.");
  }

  const request = buildRequest(base, withToken("/api/whoami", session.token), commandHeaders());
  const res = await gatewayFetch(request.url, {
    method: "GET",
    headers: request.headers,
  });
  if (!res.ok) throw new Error(await readError(res));

  const payload = (await res.json()) as {
    result?: GatewayWhoAmI;
  };
  return payload.result ?? {};
}

export async function logoutGateway(
  base: string,
  options: {
    session?: GatewaySession;
    credentials?: GatewayCredentials;
  },
): Promise<void> {
  const path = options.session?.token
    ? withToken("/api/logout", options.session.token)
    : withCredentials("/api/logout", options.credentials);

  if (path === "/api/logout") {
    throw new Error("Logout requires either a session token or gateway credentials.");
  }

  const request = buildRequest(base, path, commandHeaders());
  const res = await gatewayFetch(request.url, {
    method: "GET",
    headers: request.headers,
  });
  if (!res.ok) throw new Error(await readError(res));
}

export type WhitelistDeviceBody = {
  deveui: string;
  class: string;
  appeui: string;
  appkey: string;
  device_profile_id?: string;
  network_profile_id?: string;
};

export async function postWhitelistDevice(
  base: string,
  body: WhitelistDeviceBody,
  session?: GatewaySession,
): Promise<void> {
  const request = buildRequest(
    base,
    withToken("/api/loraNetwork/whitelist/devices", session?.token),
    jsonHeaders(),
  );
  const res = await gatewayFetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function postSave(base: string, session?: GatewaySession): Promise<void> {
  const request = buildRequest(base, withToken("/api/command/save", session?.token), commandHeaders());
  const res = await gatewayFetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: "",
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function postLoraRestart(base: string, session?: GatewaySession): Promise<void> {
  const request = buildRequest(base, withToken("/api/lora/restart", session?.token), commandHeaders());
  const res = await gatewayFetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: "",
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** When the join server should use local whitelist keys instead of cloud key store. */
export async function putWhitelistEnabled(
  base: string,
  enabled: boolean,
  session?: GatewaySession,
): Promise<void> {
  const request = buildRequest(base, withToken("/api/loraNetwork/whitelist", session?.token), jsonHeaders());
  const res = await gatewayFetch(request.url, {
    method: "PUT",
    headers: request.headers,
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await readError(res));
}
