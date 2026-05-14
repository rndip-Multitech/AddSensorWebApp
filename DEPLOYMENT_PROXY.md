# Vercel + LAN Proxy Deployment

This document describes a **fixed-hostname LAN proxy** pattern.

If users need to enter their own varying real gateway address, the easier approach is to run the repo's built-in local backend proxy with `npm run serve:local` and let the app proxy those user-entered addresses through the local machine.

Use this document when you want a separate LAN proxy host in front of one or more known gateways.

This project can be hosted on Vercel for the frontend, but the browser should connect to a **trusted LAN proxy hostname** instead of a raw gateway IP like `https://192.168.0.89`.

This avoids:

- `ERR_CERT_AUTHORITY_INVALID`
- self-signed certificate failures from the MultiTech gateway
- direct browser access to the raw local gateway certificate

## Recommended architecture

1. Host the frontend on Vercel:
   - example: `https://onboarding.example.com`
2. Run a reverse proxy on the same LAN as the gateway:
   - example proxy hostname: `https://gw-089.example.com`
3. Configure the proxy to forward requests to the actual gateway:
   - example upstream: `https://192.168.0.89`
4. In the app, enter the **proxy hostname**, not the raw gateway IP.

The browser trusts the proxy certificate. The proxy can then connect to the gateway even if the gateway certificate is self-signed.

## Files included

- `deploy/caddy/Caddyfile.example`
- `deploy/nginx/gateway-proxy.conf.example`

Both examples:

- terminate HTTPS with a trusted certificate
- forward traffic to the gateway's LAN IP
- add CORS headers for the frontend origin
- skip upstream certificate verification because the gateway often uses a self-signed cert

## Important security notes

Do **not** turn this into an unrestricted open proxy.

Use one proxy hostname per gateway, or otherwise tightly control upstream destinations. For example:

- `gw-089.example.com` -> `192.168.0.89`
- `gw-101.example.com` -> `192.168.0.101`

That keeps the browser-facing side simple and avoids exposing arbitrary LAN routing.

## Certificate options

The proxy hostname shown to browsers needs a certificate the device trusts.

Good options:

- a certificate issued by your organization's internal PKI
- a valid public certificate for a DNS name that resolves to the proxy machine on the customer/site network

Less ideal:

- self-signed certificates on the proxy

If the proxy certificate is not trusted by the phone/laptop browser, you will still get TLS failures.

## Basic rollout

### 1. Deploy the frontend

Deploy the current app to Vercel and attach your public frontend URL.

Example:

- `https://onboarding.example.com`

### 2. Stand up the LAN proxy

Choose either:

- Caddy
- Nginx

Copy the example config and replace:

- frontend origin
- proxy hostname
- gateway IP
- certificate paths

### 3. DNS / name resolution

Make sure user devices on the same network can resolve the proxy hostname to the proxy machine.

Examples:

- internal DNS entry
- customer router DNS override
- site-local DNS server

### 4. Test

From a laptop and a phone on the same network:

1. Open the Vercel app
2. Enter the proxy hostname, for example `gw-089.example.com`
3. Click `Test gateway`
4. Add one sensor
5. Test one small bulk import

## Example mapping

- Frontend: `https://onboarding.example.com`
- Proxy: `https://gw-089.example.com`
- Gateway: `https://192.168.0.89`

In the app, the user enters:

`gw-089.example.com`

not:

`192.168.0.89`

## When to choose Caddy vs Nginx

Choose **Caddy** if you want simpler config and easier certificate handling.

Choose **Nginx** if your environment already standardizes on Nginx.
