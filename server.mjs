import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, ".env.local-server"));

const app = express();
const port = Number(process.env.PORT || 3000);
const host = (process.env.HOST || "127.0.0.1").trim();
const distDir = path.join(__dirname, "dist");
const defaultGatewayTarget = (process.env.DEFAULT_GATEWAY_TARGET || "").trim();
const maxBodyBytes = process.env.PROXY_MAX_BODY_BYTES || "10mb";
const proxyAccessKey = (process.env.PROXY_ACCESS_KEY || "").trim();
const allowPrivateIpTargets = process.env.ALLOW_PRIVATE_IP_TARGETS !== "false";
const allowHttpTargets = process.env.ALLOW_HTTP_TARGETS === "true";
const allowedGatewayHosts = new Set(
  (process.env.ALLOWED_GATEWAY_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const allowedGatewaySuffixes = (process.env.ALLOWED_GATEWAY_SUFFIXES || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const allowedGatewayCidrs = (process.env.ALLOWED_GATEWAY_CIDRS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map(parseIpv4Cidr);

function ipv4ToInteger(hostname) {
  if (net.isIP(hostname) !== 4) {
    return null;
  }

  return hostname
    .split(".")
    .map(Number)
    .reduce((result, part) => ((result << 8) | part) >>> 0, 0);
}

function parseIpv4Cidr(value) {
  const [networkAddress, prefixLengthText] = value.split("/");
  const prefixLength = Number(prefixLengthText);
  const networkInteger = ipv4ToInteger(networkAddress);

  if (
    !networkAddress ||
    prefixLengthText === undefined ||
    !Number.isInteger(prefixLength) ||
    prefixLength < 0 ||
    prefixLength > 32 ||
    networkInteger === null
  ) {
    throw new Error(`Invalid ALLOWED_GATEWAY_CIDRS entry: ${value}`);
  }

  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;

  return {
    source: value,
    network: networkInteger & mask,
    mask,
  };
}

function isInAllowedIpv4Cidr(hostname) {
  const address = ipv4ToInteger(hostname);
  if (address === null) {
    return false;
  }

  return allowedGatewayCidrs.some((cidr) => (address & cidr.mask) === cidr.network);
}

function isPrivateIpAddress(hostname) {
  const version = net.isIP(hostname);

  if (version === 4) {
    const parts = hostname.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  if (version === 6) {
    const normalized = hostname.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

function isAllowedGatewayTarget(target) {
  const hostname = target.hostname.toLowerCase();
  const protocolAllowed = target.protocol === "https:" || (allowHttpTargets && target.protocol === "http:");

  if (!protocolAllowed) {
    return {
      ok: false,
      message: `Unsupported gateway protocol: ${target.protocol}`,
    };
  }

  if (target.username || target.password) {
    return {
      ok: false,
      message: "Gateway targets must not include embedded credentials.",
    };
  }

  if (allowedGatewayHosts.size > 0 || allowedGatewaySuffixes.length > 0 || allowedGatewayCidrs.length > 0) {
    const exactMatch = allowedGatewayHosts.has(hostname);
    const suffixMatch = allowedGatewaySuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
    const cidrMatch = isInAllowedIpv4Cidr(hostname);

    if (!exactMatch && !suffixMatch && !cidrMatch) {
      return {
        ok: false,
        message: `Gateway target ${hostname} is not in the allowed host, suffix, or CIDR list.`,
      };
    }

    return { ok: true };
  }

  if (!allowPrivateIpTargets) {
    return {
      ok: false,
      message: "Gateway proxy is restricted and no allowed hosts were configured.",
    };
  }

  if (!isPrivateIpAddress(hostname)) {
    return {
      ok: false,
      message: `Gateway target ${hostname} must be a private IP address unless explicitly allowlisted.`,
    };
  }

  return { ok: true };
}

app.get("/runtime-config.js", (_req, res) => {
  res.type("application/javascript");
  res.send(
    `window.__APP_RUNTIME_CONFIG__ = { useGatewayProxy: true, requireProxyAccessKey: ${proxyAccessKey ? "true" : "false"} };`,
  );
});

app.use(
  "/__gateway__",
  express.raw({
    inflate: true,
    limit: maxBodyBytes,
    type: () => true,
  }),
);

app.use("/__gateway__", (req, res) => {
  if (proxyAccessKey && req.get("x-proxy-access-key") !== proxyAccessKey) {
    res.status(401).json({
      error: "Missing or invalid proxy access key.",
    });
    return;
  }

  const rawHeader = req.get("x-gateway-target");
  const targetValue = (rawHeader || defaultGatewayTarget).trim();

  if (!targetValue) {
    res.status(400).json({
      error: "No gateway target was provided.",
    });
    return;
  }

  let target;
  try {
    target = new URL(targetValue);
  } catch {
    res.status(400).json({
      error: `Invalid gateway target: ${targetValue}`,
    });
    return;
  }

  if (!/^https?:$/.test(target.protocol)) {
    res.status(400).json({
      error: `Unsupported gateway protocol: ${target.protocol}`,
    });
    return;
  }

  const allowedTarget = isAllowedGatewayTarget(target);
  if (!allowedTarget.ok) {
    res.status(403).json({
      error: allowedTarget.message,
    });
    return;
  }

  const upstreamPath = `${target.pathname.replace(/\/$/, "")}${req.originalUrl.replace(/^\/__gateway__/, "") || "/"}`;
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  const headers = { ...req.headers };
  delete headers.host;
  delete headers.origin;
  delete headers.referer;
  delete headers.connection;
  delete headers["x-gateway-target"];
  delete headers["x-proxy-access-key"];

  if (body.length > 0) {
    headers["content-length"] = String(body.length);
  } else {
    delete headers["content-length"];
  }

  const requestImpl = target.protocol === "https:" ? httpsRequest : httpRequest;
  const upstreamReq = requestImpl(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: upstreamPath,
      headers,
      rejectUnauthorized: false,
    },
    (upstreamRes) => {
      res.status(upstreamRes.statusCode ?? 502);
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value !== undefined) {
          res.setHeader(name, value);
        }
      }
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (error) => {
    if (!res.headersSent) {
      res.status(502).json({
        error: `Proxy request to ${target.origin} failed: ${error.message}`,
      });
    }
  });

  if (body.length > 0) {
    upstreamReq.write(body);
  }

  upstreamReq.end();
});

app.use(express.static(distDir));

app.use((_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, host, () => {
  console.log(`Multitech Sensor Onboarding server listening on http://${host}:${port}`);
  console.log(`Gateway target policy: ${allowedGatewayHosts.size || allowedGatewaySuffixes.length || allowedGatewayCidrs.length ? "allowlist" : allowPrivateIpTargets ? "private-ip-only" : "blocked unless allowlisted"}`);
  if (proxyAccessKey) {
    console.log("Proxy access key is enabled.");
  }
});
