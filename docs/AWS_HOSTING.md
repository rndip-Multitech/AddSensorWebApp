# Hosting on AWS (public URL)

Vercel was only a fast place to put the static UI. This app is designed to run as **one Node service** (`server.mjs`) that serves the React build **and** proxies gateway API calls on the same hostname.

That model deploys cleanly to **AWS Lightsail** or **EC2** with a public URL and optional custom domain.

## What AWS gives you

| Benefit | Notes |
|---------|--------|
| Public HTTPS URL | e.g. `https://onboarding.yourdomain.com` |
| Same-origin proxy | Browser calls `/__gateway__` on the same host — **no CORS fight with Vercel** |
| Self-signed gateway certs | Proxy uses `rejectUnauthorized: false` server-side |
| You control TLS, firewall, updates | Unlike serverless-only hosting |

## What AWS does **not** magically fix

The server runs in **AWS’s network**. When a user enters `192.168.0.162`, the proxy tries to open that address **from the AWS machine**, not from the user’s laptop.

```text
User browser  →  https://onboarding.aws.com/__gateway__  →  AWS server  →  192.168.0.162 ?
                                                              ↑
                                    Only works if this hop can route to the gateway
```

So:

- **Works** if the gateway is reachable from AWS: public IP/hostname, VPN into the site, Tailscale/ZeroTier IP, site-to-site VPN, or the server is on the LAN (see below).
- **Does not work** if the gateway is **only** on a customer home/office LAN and nothing connects that LAN to AWS.

Your office-vs-home issue is partly this: at home the laptop and gateway shared a LAN; from a cloud server, `192.168.x.x` is someone else’s private network.

## Recommended AWS setups

### 1. Lightsail / EC2 — full app (most common for you)

One small instance runs the Docker image (or `npm run serve:local`).

- Users open **one URL**; enter **gateway IP/hostname + credentials** only.
- Set `PROXY_ACCESS_KEY` so random internet traffic cannot use your proxy.
- Restrict `ALLOWED_GATEWAY_CIDRS` / hosts to IPs you expect.

**Good when:** gateways are on the public internet, or AWS is VPN-connected to networks where gateways live (corporate VPN, Tailscale, etc.).

### 2. Static site on S3 + CloudFront only

Same limitation as Vercel: **no server-side proxy** unless you add API Gateway + Lambda/EC2. Not recommended for this project without a separate API layer.

### 3. “Website on AWS” but onboarding at the site

Keep a public AWS URL for docs/downloads; field work uses the **same app** installed on a laptop or a **small on-site appliance** (Pi/NUC) on the LAN. That is still the right model for arbitrary customer LANs.

### 4. Internal Multitech: AWS + Tailscale (or VPN)

Put the Lightsail instance on your tailnet; gateways use Tailscale IPs or MagicDNS. Users use the public or tailnet URL; AWS proxy reaches gateways over Tailscale. Strong option for internal tooling.

## Quick deploy (Lightsail)

### Prerequisites

- AWS account
- Domain (optional) pointing at the instance

### Steps

1. Create a **Lightsail** instance (Ubuntu 22.04, $10/mo is enough to start).
2. Open firewall: **443** (and **80** if you terminate HTTP there).
3. SSH in, install Docker, clone this repo, or pull your image from ECR.
4. Create `.env.local-server` on the instance (see `.env.local-server.example`).
5. Run the container (see root `Dockerfile`).
6. Put **Caddy** or **nginx** in front for HTTPS with Let’s Encrypt, or use Lightsail load balancer + certificate.

Example `.env.local-server` on a **public** instance:

```ini
HOST=0.0.0.0
PORT=3000
PROXY_ACCESS_KEY=<long-random-secret>
ALLOW_PRIVATE_IP_TARGETS=true
ALLOWED_GATEWAY_CIDRS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/24
ALLOW_HTTP_TARGETS=false
```

Tighten CIDRs to networks you actually use. On a **public** internet host, `PROXY_ACCESS_KEY` is mandatory.

The browser app reads `runtime-config.js` from the same server (`useGatewayProxy: true`). Users do **not** need a separate “proxy URL” field when they use this deployment URL.

### Smoke test

From your laptop:

1. Open `https://onboarding.yourdomain.com`
2. Enter a gateway address **reachable from the Lightsail instance** (test with `curl -k https://<gateway>/api/login` **from the instance** first).
3. Test gateway → add device.

If curl from the instance fails, the app will fail too — fix routing/VPN/firewall first.

## Security on a public AWS host

- Always set `PROXY_ACCESS_KEY`; inject it only via env on the server, not in the public repo.
- Prefer allowlists (`ALLOWED_GATEWAY_CIDRS`, `ALLOWED_GATEWAY_HOSTS`).
- Do not expose port 3000 directly without TLS; use reverse proxy + HTTPS.
- Rotate the access key if leaked.

## Versus Vercel

| | Vercel | AWS (this app on Lightsail) |
|--|--------|------------------------------|
| Static UI | Yes | Yes (via `dist/`) |
| Gateway proxy | No (unless user LAN bridge) | Yes, same origin |
| Reach private `192.168.x.x` from cloud | No | Only if network path exists |
| Custom domain | Yes | Yes |

## Next product decision

For **arbitrary customer sites** with LAN-only gateways, you still need **either**:

- VPN/Tailscale/cloud path from AWS to that LAN, or  
- On-site runner (laptop/appliance), or  
- A future **outbound site agent** (see `ARCHITECTURE_OPTIONS.md`).

For **Multitech-controlled** gateways (public IP, VPN, or tailnet), **AWS Lightsail + this Docker image** is a solid replacement for Vercel and keeps the UX to gateway IP + login only.
