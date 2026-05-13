# Multitech Sensor Onboarding

React + Vite app for onboarding LoRaWAN sensors onto a MultiTech gateway.

## Local development

```bash
npm install
npm run dev
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

## Production network assumptions

This app currently talks from the browser directly to the MultiTech gateway API.

For a Vercel-hosted deployment to work reliably, the user device must:

- be on the same network as the gateway
- reach the gateway over `https://`
- trust the gateway certificate
- be allowed by the gateway/browser to make cross-origin API requests

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
