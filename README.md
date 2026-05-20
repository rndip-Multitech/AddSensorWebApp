# Multitech Sensor Onboarding

React + Vite app for onboarding LoRaWAN sensors onto a MultiTech gateway.

## Local development

```bash
npm install
npm run dev
```

## Local production proxy

This repo now includes a real local backend proxy server for production-style use on a laptop or local PC.

Run it with:

```bash
npm run serve:local
```

Then open:

`http://localhost:3000`

When served this way, the app routes gateway API calls through the local Node server instead of sending them directly from the browser. This is what allows the app to work with gateways that use self-signed or otherwise untrusted HTTPS certificates.

### Recommended real-settings setup

1. Copy `.env.local-server.example` to `.env.local-server`
2. Edit the values for your site/machine
3. Run:

```bash
npm run serve:local
```

The server will automatically load `.env.local-server` if it exists.

### Example for your first gateway

Create `.env.local-server` with:

```ini
HOST=0.0.0.0
PORT=3000
PROXY_ACCESS_KEY=change-this-secret
ALLOWED_GATEWAY_CIDRS=192.168.0.0/24
ALLOW_PRIVATE_IP_TARGETS=true
ALLOW_HTTP_TARGETS=false
```

Then start:

```bash
npm run serve:local
```

Open:

- on the hosting PC: `http://localhost:3000`
- on a phone/tablet on the same Wi-Fi: `http://<your-computer-lan-ip>:3000`

In the app:

- enter the real gateway address: `192.168.0.89`
- enter the gateway username/password
- enter the proxy access key you set in `.env.local-server`

By default, the local server binds to `127.0.0.1`, which means only the hosting machine can reach it.

If you want to open it from a phone or another device on the same network, run it on all interfaces:

```powershell
$env:HOST="0.0.0.0"
npm run serve:local
```

Then browse to:

`http://<your-computer-lan-ip>:3000`

If you want to bind the local server to a different port:

```bash
PORT=8080 npm run serve:local
```

On Windows PowerShell:

```powershell
$env:PORT=8080
npm run serve:local
```

## Proxy hardening

The local proxy now supports safer deployment controls through environment variables:

- `HOST`
  - default: `127.0.0.1`
  - use `0.0.0.0` only when you intentionally want LAN access
- `PROXY_ACCESS_KEY`
  - optional shared secret required before the proxy will forward gateway requests
- `ALLOWED_GATEWAY_HOSTS`
  - comma-separated allowlist of exact gateway IPs/hosts
- `ALLOWED_GATEWAY_CIDRS`
  - comma-separated IPv4 CIDR allowlist such as `192.168.0.0/24`
- `ALLOWED_GATEWAY_SUFFIXES`
  - comma-separated allowed DNS suffixes
- `ALLOW_PRIVATE_IP_TARGETS`
  - default: `true`
  - if `false`, only allowlisted hosts/suffixes can be proxied
- `ALLOW_HTTP_TARGETS`
  - default: `false`
  - leave this off unless you truly need plain HTTP gateways
- `DEFAULT_GATEWAY_TARGET`
  - optional fixed gateway target if you want to avoid user entry

### Safer LAN example

```powershell
$env:HOST="0.0.0.0"
$env:PROXY_ACCESS_KEY="change-this-secret"
$env:ALLOWED_GATEWAY_CIDRS="192.168.0.0/24"
npm run serve:local
```

That lets phones/tablets on the same Wi-Fi use the app while still requiring an access key and restricting which gateway addresses can be proxied to the local subnet.

## Windows startup task

You can install the local server as a Windows startup task for the current user.

Example:

```powershell
.\scripts\install-startup-task.ps1 -Host "0.0.0.0" -Port 3000 -ProxyAccessKey "change-this-secret" -AllowedGatewayCidrs "192.168.0.0/24"
```

This will:

1. build the app
2. register a Windows Scheduled Task
3. start the local server automatically at logon

To remove it:

```powershell
.\scripts\remove-startup-task.ps1
```

## Vercel deployment

This project is ready for a Vercel preview deployment as a static frontend.

### Deploy

1. Push the repo to GitHub, GitLab, or Bitbucket.
2. In Vercel, import the repository.
3. Confirm these settings:
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Output directory: `dist`
4. Deploy.

`vercel.json` is included so Vercel uses the expected build/output settings.

If your hosted preview fails to connect to a gateway because of certificate trust problems like `ERR_CERT_AUTHORITY_INVALID`, use the local production proxy above or see `DEPLOYMENT_PROXY.md` for LAN proxy architecture options.

If login works from Vercel but add/import fails with a CORS error, the gateway is blocking `POST`/`PUT` from the hosted site. Run the local proxy on a PC on the same Wi-Fi, set `PROXY_CORS_ORIGINS` to your Vercel URL in `.env.local-server`, then enter that PC's proxy URL in the hosted app's **Local proxy URL** field.

## Production network assumptions

On Vercel, the browser may reach `GET /api/login` directly after you trust the gateway certificate, but follow-up API calls such as whitelist `POST`/`PUT` are usually blocked by gateway CORS.

For a reliable Vercel deployment:

- run `npm run serve:local` on a PC on the same network as the gateway
- bind it to the LAN if phones need it (`HOST=0.0.0.0`)
- set `PROXY_ACCESS_KEY` and `PROXY_CORS_ORIGINS=https://your-app.vercel.app`
- enter that proxy URL in the hosted app (not a fixed gateway hostname in the proxy config)

If any of those are not true, you will likely need a proxy or local bridge instead of direct browser-to-gateway access.

## Preflight test checklist

Before going live, test the Vercel preview from the same type of network your users will use:

1. Open the Vercel preview on a laptop on the same Wi-Fi as the gateway.
2. Run `Test gateway`.
3. Confirm the gateway connects successfully over HTTPS.
4. Scan or paste a real QR payload and add a single sensor.
5. Test bulk import with a small CSV or JSON file.
6. Repeat on a phone connected to the same Wi-Fi.

## Go / no-go decision

Vercel is a good fit if:

- `Test gateway` works from the Vercel preview
- sensor add works from the Vercel preview
- phone testing on the same Wi-Fi also works

If the hosted preview fails because of browser/network restrictions, keep the frontend but move production gateway traffic behind a proxy or local companion service.
