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

async function readError(res: Response): Promise<string> {
  const t = await res.text();
  try {
    const j = JSON.parse(t) as {
      message?: string;
      error?: string;
      status?: string;
      result?: { message?: string; error?: string };
    };
    return j.message || j.error || j.result?.message || j.result?.error || t || res.statusText;
  } catch {
    return t || res.statusText;
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

function shouldUseGatewayProxy(): boolean {
  if (import.meta.env.DEV) return true;
  return Boolean(window.__APP_RUNTIME_CONFIG__?.useGatewayProxy);
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
    return {
      url: `/__gateway__${path}`,
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

export async function probeGateway(base: string): Promise<number> {
  const request = buildRequest(base, "/api/login", commandHeaders());
  const res = await fetch(request.url, {
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
  const res = await fetch(request.url, {
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
  const res = await fetch(request.url, {
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
  const res = await fetch(request.url, {
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
  const res = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function postSave(base: string, session?: GatewaySession): Promise<void> {
  const request = buildRequest(base, withToken("/api/command/save", session?.token), commandHeaders());
  const res = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: "",
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function postLoraRestart(base: string, session?: GatewaySession): Promise<void> {
  const request = buildRequest(base, withToken("/api/lora/restart", session?.token), commandHeaders());
  const res = await fetch(request.url, {
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
  const res = await fetch(request.url, {
    method: "PUT",
    headers: request.headers,
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await readError(res));
}
