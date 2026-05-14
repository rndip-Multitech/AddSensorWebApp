/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_GATEWAY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __APP_RUNTIME_CONFIG__?: {
    useGatewayProxy?: boolean;
    requireProxyAccessKey?: boolean;
  };
}
