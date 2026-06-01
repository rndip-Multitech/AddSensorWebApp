import { CapacitorHttp } from "@capacitor/core";
import { isNativeApp } from "./platform";

export type GatewayFetchInit = {
  method?: string;
  headers?: HeadersInit;
  body?: string;
};

export type GatewayFetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return { ...headers };
}

function normalizeResponseData(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }

  if (data === undefined || data === null) {
    return "";
  }

  return JSON.stringify(data);
}

async function nativeGatewayFetch(url: string, init: GatewayFetchInit = {}): Promise<GatewayFetchResponse> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = headersToRecord(init.headers);
  const body = init.body;

  const response = await CapacitorHttp.request({
    url,
    method,
    headers,
    ...(body !== undefined ? { data: body } : {}),
    responseType: "text",
  });

  const status = response.status ?? 0;
  const rawText = normalizeResponseData(response.data);

  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => rawText,
    json: async () => {
      if (!rawText) {
        return {};
      }

      try {
        return JSON.parse(rawText) as unknown;
      } catch {
        throw new Error("Gateway response was not valid JSON.");
      }
    },
  };
}

async function webGatewayFetch(url: string, init: GatewayFetchInit = {}): Promise<GatewayFetchResponse> {
  const res = await fetch(url, init);
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
    json: () => res.json(),
  };
}

export async function gatewayFetch(url: string, init: GatewayFetchInit = {}): Promise<GatewayFetchResponse> {
  if (isNativeApp()) {
    return nativeGatewayFetch(url, init);
  }

  return webGatewayFetch(url, init);
}
