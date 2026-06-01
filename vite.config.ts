import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * In development, requests can be routed through /__gateway__ so the browser avoids CORS
 * and certificate issues when talking to a local MultiTech gateway. The target can come
 * from the X-Gateway-Target request header or VITE_DEV_GATEWAY_TARGET in .env.local.
 */
function writeJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function dynamicGatewayProxy(defaultTarget: string): Plugin {
  return {
    name: "dynamic-gateway-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__gateway__", async (req, res) => {
        const rawHeader = req.headers["x-gateway-target"];
        const headerTarget = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
        const targetValue = (headerTarget || defaultTarget || "").trim();

        if (!targetValue) {
          writeJson(res, 400, {
            error:
              "No gateway target was provided. Enter the gateway IP in the app or set VITE_DEV_GATEWAY_TARGET in .env.local, then restart Vite.",
          });
          return;
        }

        let target: URL;
        try {
          target = new URL(targetValue);
        } catch {
          writeJson(res, 400, {
            error: `Invalid gateway target: ${targetValue}`,
          });
          return;
        }

        if (!/^https?:$/.test(target.protocol)) {
          writeJson(res, 400, {
            error: `Unsupported gateway protocol: ${target.protocol}`,
          });
          return;
        }

        try {
          const body = await readBody(req);
          const requestPath = req.url && req.url.length > 0 ? req.url : "/";
          const basePath = target.pathname.replace(/\/$/, "");
          const upstreamPath = `${basePath}${requestPath}`;

          const forwardedHeaders = Object.fromEntries(
            Object.entries(req.headers).filter(([name]) => {
              const key = name.toLowerCase();
              return ![
                "host",
                "origin",
                "referer",
                "connection",
                "content-length",
                "x-gateway-target",
              ].includes(key);
            }),
          );

          if (body.length > 0) {
            forwardedHeaders["content-length"] = String(body.length);
          }

          const requestImpl = target.protocol === "https:" ? httpsRequest : httpRequest;
          const upstreamReq = requestImpl(
            {
              protocol: target.protocol,
              hostname: target.hostname,
              port: target.port,
              method: req.method,
              path: upstreamPath,
              headers: forwardedHeaders,
              rejectUnauthorized: false,
            },
            (upstreamRes) => {
              res.statusCode = upstreamRes.statusCode ?? 502;
              for (const [name, value] of Object.entries(upstreamRes.headers)) {
                if (value !== undefined) {
                  res.setHeader(name, value);
                }
              }
              upstreamRes.pipe(res);
            },
          );

          upstreamReq.on("error", (error) => {
            writeJson(res, 502, {
              error: `Proxy request to ${target.origin} failed: ${error.message}`,
            });
          });

          if (body.length > 0) {
            upstreamReq.write(body);
          }
          upstreamReq.end();
        } catch (error) {
          writeJson(res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_DEV_GATEWAY_TARGET?.replace(/\/$/, "") || "";

  const isMobileBuild = mode === "mobile";

  return {
    base: isMobileBuild ? "./" : "/",
    plugins: [react(), dynamicGatewayProxy(target)],
  };
});
