# Native mobile app (recommended direction)

For onboarding sensors on a gateway that is usually on **local Wi‑Fi** (`192.168.x.x`), a **native iOS/Android app** is the best fit:

- No CORS (not a browser)
- Phone on the same network can call the gateway API directly
- QR/camera and LAN permissions are first-class
- No AWS proxy or user-visible “local proxy URL” for the common on-site case

Public web hosting (Vercel/AWS) remains optional for marketing, docs, or future cloud features—not for direct LAN `192.168` API calls.

## Reuse this repo

The UI and logic already live in React (`src/App.tsx`, `gatewayApi.ts`, `parseQr.ts`, etc.). Fastest path:

### Option 1 — **Capacitor** (recommended)

Wrap the existing Vite build in a native shell.

| Pros | Cons |
|------|------|
| Reuse almost all current code | Still need native config for HTTPS to self-signed gateway |
| One codebase for web + mobile | Slightly less “pure native” than Swift/Kotlin |
| QR via web APIs or Capacitor plugins | App Store review + signing overhead |

**High-level steps:**

1. `npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`
2. `npx cap init` (app id e.g. `com.multitech.sensor-onboarding`)
3. Point Capacitor `webDir` at `dist` after `npm run build`
4. Add plugins: `@capacitor/camera` or keep `html5-qrcode` with camera permissions
5. **Gateway HTTP client:** use Capacitor’s HTTP plugin or fetch with native TLS handling for self-signed certs (see below)
6. `npx cap add ios` / `npx cap add android`, open Xcode/Android Studio, set permissions

### Option 2 — **React Native / Expo**

Rewrite UI in RN or share types only. More work; better if you later need heavy native UI.

### Option 3 — **Swift + Kotlin**

Two codebases; only if Capacitor limits you (unlikely for this app).

## Changes from the web app

### 1. Drop browser-only proxy for mobile builds

In a native build, `gatewayApi.ts` should call the gateway **directly** (`https://192.168.0.89/api/...`), not `/__gateway__`.

Use a build flag, e.g. `import.meta.env.VITE_NATIVE_APP` or Capacitor `Capacitor.isNativePlatform()`, to skip `shouldUseGatewayProxy()`.

### 2. Self-signed gateway HTTPS

Gateways often use certificates the phone does not trust.

- **iOS:** custom `URLSession` delegate or plugin that allows pinning / trust-on-first-use for LAN (document security tradeoff)
- **Android:** network security config for debug; production: pin gateway cert or user confirms once
- **Capacitor:** `@capacitor-community/http` or native TLS plugin; avoid plain `fetch` until trust is solved

### 3. Permissions

| Platform | Purpose |
|----------|---------|
| iOS `NSCameraUsageDescription` | QR scan |
| iOS `NSLocalNetworkUsageDescription` | Access `192.168.x.x` on LAN (iOS 14+) |
| Android `CAMERA` | QR scan |
| Android cleartext | Only if you support `http://` gateways |

### 4. UI cleanup for mobile

- Remove: Local proxy URL, proxy access key (hosted-web only)
- Keep: Gateway address, HTTPS scheme, credentials, QR, profiles, add/import
- Safe area, larger touch targets, optional offline hint when gateway unreachable

### 5. Corporate / guest Wi‑Fi

Native does not fix **AP isolation** (phone cannot talk to gateway on “same SSID”). Show a clear error: “Connect to a network that allows access to the gateway” or use guest Wi‑Fi that isn’t client-isolated.

## What you do not need for v1 mobile

- AWS in the request path for on-site onboarding
- Vercel deployment for installers
- CORS / `PROXY_CORS_ORIGINS` workarounds

Optional later: cloud account, sync, analytics, remote gateways via public hostname.

## Suggested phases

### Phase 1 — Capacitor MVP

- Capacitor shell + existing React UI
- Direct gateway API on native only
- QR scan on device
- Test on real iPhone/Android on same Wi‑Fi as gateway
- Internal TestFlight / Play internal testing

### Phase 2 — TLS and polish

- Reliable trust flow for self-signed gateway cert
- Remember recent gateways (already in `gatewayUrl.ts`)
- Error copy for LAN isolation / wrong IP

### Phase 3 — Store release

- App icons, privacy policy, local network justification for Apple
- Multitech branding

### Phase 4 (optional) — Cloud

- Public hostname gateways, VPN sites, or outbound agent—only if product requires off-LAN onboarding

## Apple review note

Explain **Local Network** usage: “Connect to the MultiTech LoRa gateway on the customer’s network to configure sensors.” Apple expects a clear string in `Info.plist`.

## Phase 1 scaffold (in this repo)

Capacitor is wired up:

| Piece | Location |
|-------|----------|
| Config | `capacitor.config.ts` |
| Native vs web | `src/platform.ts`, `src/gatewayFetch.ts`, `src/gatewayApi.ts` |
| Mobile build | `npm run build:mobile` (Vite `base: ./`) |
| Sync platforms | `npm run cap:sync` |
| Android Studio | `npm run cap:android` |
| Xcode (macOS) | `npm run cap:ios` |
| LAN TLS / permissions | `scripts/apply-native-config.ps1` (runs after `cap:sync`) |

On native, the app calls the gateway **directly** (no proxy URL fields in the UI).

### Run on a device

**Android (Windows):**

1. Install [Android Studio](https://developer.android.com/studio) and SDK.
2. `npm run cap:android`
3. In Android Studio: run on a physical device (USB debugging) on the **same Wi‑Fi as the gateway**.
4. Enter gateway IP, credentials, test add sensor.

**iOS (macOS only):**

1. `npm run cap:ios`
2. Open workspace in Xcode, set signing team, run on iPhone on same network as gateway.

### After UI changes

```bash
npm run cap:sync
```

### Troubleshooting

- **Certificate errors:** gateway uses self-signed HTTPS; Android config trusts user CAs; iOS allows local networking. If it still fails, we may need a dedicated cert-trust plugin.
- **Cannot reach gateway:** guest/corporate Wi‑Fi client isolation — try another network or hotspot.
- **QR camera:** grant camera permission when prompted.
