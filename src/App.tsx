import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  createGatewaySession,
  describeGatewayError,
  getWhoAmI,
  isDirectBrowserGatewayMode,
  logoutGateway,
  postLoraRestart,
  postSave,
  postWhitelistDevice,
  putWhitelistEnabled,
  usesBuiltInGatewayProxy,
  type GatewayCredentials,
  type GatewaySession,
  type WhitelistDeviceBody,
} from "./gatewayApi";
import { parseDeviceImport } from "./bulkImport";
import {
  loadRecentGateways,
  rememberGateway,
  resolveGatewayBase,
  type GatewayScheme,
} from "./gatewayUrl";
import { normalizeHex, parseQrPayload, type ParsedCredentials } from "./parseQr";

function SectionStatus({
  success,
  error,
}: {
  success: string | null;
  error: string | null;
}) {
  if (!success && !error) return null;

  return (
    <p style={error ? statusErrorStyle : statusSuccessStyle} role={error ? "alert" : "status"}>
      {error ?? success}
    </p>
  );
}

type ActiveTab = "single" | "import";

export default function App() {
  const readerId = useId().replace(/:/g, "");
  const readerDomId = `qr-${readerId}`;
  const gatewayDatalistId = `gw-recent-${readerId}`;
  const qrRef = useRef<Html5Qrcode | null>(null);

  const [gatewayBase, setGatewayBase] = useState("");
  const [gatewayScheme, setGatewayScheme] = useState<GatewayScheme>("https");
  const [recentGateways, setRecentGateways] = useState<string[]>(loadRecentGateways);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [proxyAccessKey, setProxyAccessKey] = useState(() => {
    try {
      return localStorage.getItem("proxyAccessKey") ?? "";
    } catch {
      return "";
    }
  });
  const [proxyBaseUrl, setProxyBaseUrl] = useState(() => {
    try {
      return localStorage.getItem("gatewayProxyBaseUrl") ?? "";
    } catch {
      return "";
    }
  });

  const [defaultAppeui, setDefaultAppeui] = useState("");
  const [deviceClass, setDeviceClass] = useState("A");
  const [deviceProfileId, setDeviceProfileId] = useState("");
  const [networkProfileId, setNetworkProfileId] = useState("");

  const [rawQrPayload, setRawQrPayload] = useState("");
  const [parsedDeviceName, setParsedDeviceName] = useState("");
  const [parsedSerialNumber, setParsedSerialNumber] = useState("");

  const [deveui, setDeveui] = useState("");
  const [appeui, setAppeui] = useState("");
  const [appkey, setAppkey] = useState("");

  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testingGateway, setTestingGateway] = useState(false);
  const [disconnectingGateway, setDisconnectingGateway] = useState(false);
  const [gatewayConnected, setGatewayConnected] = useState(false);

  const [gatewayStatus, setGatewayStatus] = useState<string | null>(null);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [importDevices, setImportDevices] = useState<WhitelistDeviceBody[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importingFile, setImportingFile] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("single");

  const [saveAfter, setSaveAfter] = useState(true);
  const [restartAfter, setRestartAfter] = useState(true);
  const [enableWhitelistMode, setEnableWhitelistMode] = useState(false);

  const resolvedBase = resolveGatewayBase(gatewayBase, gatewayScheme);
  const effectiveAppeui = normalizeHex(appeui) || normalizeHex(defaultAppeui);
  const isWorking = busy || testingGateway || importingFile || disconnectingGateway;
  const showHostedProxyFields = !usesBuiltInGatewayProxy();
  const proxyAccessKeyRequired = Boolean(window.__APP_RUNTIME_CONFIG__?.requireProxyAccessKey);
  const showProxyAccessKeyField = proxyAccessKeyRequired || Boolean(proxyBaseUrl.trim());
  const gatewayBlockedMessage = [gatewayError, submitError, importError].find(
    (message) => message && /cors|access-control|blocked the gateway request/i.test(message),
  );
  const showCorsHelp =
    showHostedProxyFields &&
    Boolean(gatewayBlockedMessage || ((submitError || importError) && !proxyBaseUrl.trim()));
  const showCertHelp =
    Boolean(gatewayError) &&
    isDirectBrowserGatewayMode() &&
    /^https:\/\//i.test(resolvedBase) &&
    !showCorsHelp;

  useEffect(() => {
    setGatewayConnected(false);
    setGatewayStatus(null);
    setGatewayError(null);
  }, [gatewayBase, gatewayScheme, username, password]);

  useEffect(() => {
    try {
      localStorage.setItem("proxyAccessKey", proxyAccessKey);
    } catch {
      /* ignore */
    }
  }, [proxyAccessKey]);

  useEffect(() => {
    try {
      localStorage.setItem("gatewayProxyBaseUrl", proxyBaseUrl.trim());
    } catch {
      /* ignore */
    }
  }, [proxyBaseUrl]);

  const applyParsed = useCallback((parsed: ParsedCredentials) => {
    setDeveui(parsed.deveui);
    setAppeui(parsed.appeui);
    setAppkey(parsed.appkey);
    setParsedDeviceName(parsed.deviceName ?? "");
    setParsedSerialNumber(parsed.serialNumber ?? "");
    setQrError(null);
    setQrStatus(
      parsed.deviceName || parsed.serialNumber
        ? `QR parsed for ${parsed.deviceName ?? "sensor"}${parsed.serialNumber ? ` (serial ${parsed.serialNumber})` : ""}.`
        : "QR parsed successfully.",
    );
  }, []);

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setImportStatus(null);
    setImportError(null);
    setImportDevices([]);
    setImportFileName("");

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const result = parseDeviceImport(file.name, text);
      setImportDevices(result.devices);
      setImportFileName(file.name);
      setImportStatus(`${result.devices.length} devices ready from ${file.name}.`);
    } catch (error) {
      setImportError(describeGatewayError(error));
    } finally {
      event.target.value = "";
    }
  };

  const stopScanner = useCallback(async () => {
    const qr = qrRef.current;
    qrRef.current = null;
    if (!qr) return;

    try {
      await qr.stop();
    } catch {
      /* ignore */
    }

    try {
      qr.clear();
    } catch {
      /* ignore */
    }

    setScanning(false);
  }, []);

  const onDecoded = useCallback(
    (text: string) => {
      const parsed = parseQrPayload(text);
      if (!parsed) {
        setQrStatus(null);
        setQrError("QR format was not recognized.");
        return;
      }

      setRawQrPayload(text);
      applyParsed(parsed);
      void stopScanner();
    },
    [applyParsed, stopScanner],
  );

  const parseManualQr = () => {
    setQrStatus(null);
    setQrError(null);

    const parsed = parseQrPayload(rawQrPayload);
    if (!parsed) {
      setQrError("Could not parse the pasted QR text.");
      return;
    }

    applyParsed(parsed);
  };

  const startScanner = useCallback(async () => {
    setQrStatus(null);
    setQrError(null);

    try {
      const qr = new Html5Qrcode(readerDomId);
      qrRef.current = qr;
      await qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 280, height: 280 } },
        (decodedText) => {
          onDecoded(decodedText);
        },
        () => {},
      );
      setScanning(true);
      setQrStatus("Camera ready.");
    } catch (error) {
      setQrError(error instanceof Error ? error.message : String(error));
      qrRef.current = null;
    }
  }, [onDecoded, readerDomId]);

  useEffect(() => {
    return () => {
      void stopScanner();
    };
  }, [stopScanner]);

  const getCredentials = (): GatewayCredentials => {
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
      throw new Error("Gateway username and password are required.");
    }

    return {
      username: trimmedUsername,
      password: trimmedPassword,
    };
  };

  const getExternalProxyValidationError = (): string | null => {
    if (!showHostedProxyFields) {
      return null;
    }

    const trimmedProxyBaseUrl = proxyBaseUrl.trim();
    if (!trimmedProxyBaseUrl) {
      return "Enter the local proxy URL in Connect to gateway when using the hosted app.";
    }

    try {
      const parsed = new URL(trimmedProxyBaseUrl);
      if (!/^https?:$/.test(parsed.protocol)) {
        return "Local proxy URL must start with http:// or https://.";
      }
    } catch {
      return "Local proxy URL is not a valid URL.";
    }

    return null;
  };

  const rememberSuccessfulGateway = () => {
    rememberGateway(resolvedBase);
    setRecentGateways(loadRecentGateways());
  };

  const disconnectGateway = async () => {
    setGatewayStatus(null);
    setGatewayError(null);

    if (!resolvedBase) {
      setGatewayError("Enter the gateway address.");
      return;
    }

    if (proxyAccessKeyRequired && !proxyAccessKey.trim()) {
      setGatewayError("Proxy access key is required.");
      return;
    }

    let credentials: GatewayCredentials;
    try {
      credentials = getCredentials();
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error));
      return;
    }

    setDisconnectingGateway(true);
    try {
      await logoutGateway(resolvedBase, { credentials });
      setGatewayConnected(false);
      setGatewayStatus("Gateway session cleared.");
    } catch (error) {
      setGatewayError(describeGatewayError(error));
    } finally {
      setDisconnectingGateway(false);
    }
  };

  const testGateway = async () => {
    setGatewayStatus(null);
    setGatewayError(null);
    setImportStatus(null);
    setImportError(null);
    setSubmitStatus(null);
    setSubmitError(null);

    if (!resolvedBase) {
      setGatewayError("Enter the gateway address.");
      return;
    }

    if (proxyAccessKeyRequired && !proxyAccessKey.trim()) {
      setGatewayError("Proxy access key is required.");
      return;
    }

    let credentials: GatewayCredentials;
    try {
      credentials = getCredentials();
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error));
      return;
    }

    setTestingGateway(true);
    let session: GatewaySession | undefined;
    let verifiedMessage: string | null = null;
    let logoutFailure: string | null = null;
    try {
      session = await createGatewaySession(resolvedBase, credentials);
      const whoami = await getWhoAmI(resolvedBase, session);
      setGatewayConnected(true);
      verifiedMessage = `Connected${whoami.user ? ` as ${whoami.user}` : ""}${whoami.permission ? ` (${whoami.permission})` : ""}.`;
      rememberSuccessfulGateway();
    } catch (error) {
      setGatewayConnected(false);
      setGatewayError(describeGatewayError(error));
    } finally {
      if (session?.token) {
        try {
          await logoutGateway(resolvedBase, { session });
        } catch (error) {
          logoutFailure = `Gateway verified, but failed to close the API session: ${describeGatewayError(error)}`;
        }
      }
      if (verifiedMessage) {
        const hostedProxyReminder = showHostedProxyFields && !proxyBaseUrl.trim()
          ? " Add/import from this hosted app still needs the local proxy URL."
          : "";
        setGatewayStatus(`${verifiedMessage} Session closed.${hostedProxyReminder}`);
      }
      if (logoutFailure) {
        setGatewayError(logoutFailure);
      }
      setTestingGateway(false);
    }
  };

  const importBatch = async () => {
    setImportStatus(null);
    setImportError(null);
    setSubmitStatus(null);
    setSubmitError(null);
    setGatewayError(null);

    if (!resolvedBase) {
      setGatewayError("Enter the gateway address.");
      return;
    }

    if (proxyAccessKeyRequired && !proxyAccessKey.trim()) {
      setGatewayError("Proxy access key is required.");
      return;
    }

    if (importDevices.length === 0) {
      setImportError("Choose a CSV or JSON file first.");
      return;
    }

    const proxyValidationError = getExternalProxyValidationError();
    if (proxyValidationError) {
      setImportError(proxyValidationError);
      return;
    }

    let credentials: GatewayCredentials;
    try {
      credentials = getCredentials();
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error));
      return;
    }

    setImportingFile(true);

    let session: GatewaySession | undefined;
    let logoutFailure: string | null = null;
    try {
      session = await createGatewaySession(resolvedBase, credentials);
      setGatewayConnected(true);
      setGatewayStatus("Gateway session established.");
      rememberSuccessfulGateway();
    } catch (error) {
      setGatewayConnected(false);
      setGatewayError(describeGatewayError(error));
      setImportingFile(false);
      return;
    }

    const failures: string[] = [];
    let importedCount = 0;

    try {
      if (enableWhitelistMode) {
        await putWhitelistEnabled(resolvedBase, true, session);
      }

      for (const [index, device] of importDevices.entries()) {
        try {
          await postWhitelistDevice(resolvedBase, device, session);
          importedCount += 1;
        } catch (error) {
          failures.push(
            `Row ${index + 1} (${device.deveui}): ${describeGatewayError(error)}`,
          );
        }
      }

      if (importedCount > 0 && saveAfter) {
        await postSave(resolvedBase, session);
      }

      if (importedCount > 0 && restartAfter) {
        await postLoraRestart(resolvedBase, session);
      }

      if (failures.length === 0) {
        setImportStatus(
          `Imported ${importedCount} devices${importFileName ? ` from ${importFileName}` : ""}.`,
        );
      } else {
        setImportError(
          `Imported ${importedCount} of ${importDevices.length}. ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ""}`,
        );
      }
    } catch (error) {
      setImportError(describeGatewayError(error));
    } finally {
      if (session?.token) {
        try {
          await logoutGateway(resolvedBase, { session });
        } catch (error) {
          logoutFailure = `Import finished, but failed to close the API session: ${describeGatewayError(error)}`;
        }
      }
      if (logoutFailure) {
        setImportError(logoutFailure);
      }
      setImportingFile(false);
    }
  };

  const submit = async () => {
    setSubmitStatus(null);
    setSubmitError(null);
    setGatewayError(null);

    if (!resolvedBase) {
      setGatewayError("Enter the gateway address.");
      return;
    }

    if (proxyAccessKeyRequired && !proxyAccessKey.trim()) {
      setGatewayError("Proxy access key is required.");
      return;
    }

    let credentials: GatewayCredentials;
    try {
      credentials = getCredentials();
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error));
      return;
    }

    const normalizedDevEui = normalizeHex(deveui);
    const normalizedAppEui = effectiveAppeui;
    const normalizedAppKey = normalizeHex(appkey);

    if (normalizedDevEui.length !== 16) {
      setSubmitError("DevEUI must be 16 hex characters.");
      return;
    }

    if (normalizedAppEui.length !== 16) {
      setSubmitError("AppEUI must be 16 hex characters.");
      return;
    }

    if (normalizedAppKey.length !== 32) {
      setSubmitError("AppKey must be 32 hex characters.");
      return;
    }

    const proxyValidationError = getExternalProxyValidationError();
    if (proxyValidationError) {
      setSubmitError(proxyValidationError);
      return;
    }

    setBusy(true);

    let session: GatewaySession | undefined;
    let logoutFailure: string | null = null;
    try {
      session = await createGatewaySession(resolvedBase, credentials);
      setGatewayConnected(true);
      setGatewayStatus("Gateway session established.");
      rememberSuccessfulGateway();
    } catch (error) {
      setGatewayConnected(false);
      setGatewayError(describeGatewayError(error));
      setBusy(false);
      return;
    }

    try {
      if (enableWhitelistMode) {
        await putWhitelistEnabled(resolvedBase, true, session);
      }

      await postWhitelistDevice(resolvedBase, {
        deveui: normalizedDevEui,
        class: deviceClass,
        appeui: normalizedAppEui,
        appkey: normalizedAppKey,
        ...(deviceProfileId.trim() ? { device_profile_id: deviceProfileId.trim() } : {}),
        ...(networkProfileId.trim() ? { network_profile_id: networkProfileId.trim() } : {}),
      }, session);

      if (saveAfter) await postSave(resolvedBase, session);
      if (restartAfter) await postLoraRestart(resolvedBase, session);

      setSubmitStatus(
        saveAfter || restartAfter
          ? "Sensor added and gateway updates applied."
          : "Sensor added to the whitelist.",
      );
    } catch (error) {
      setSubmitError(describeGatewayError(error));
    } finally {
      if (session?.token) {
        try {
          await logoutGateway(resolvedBase, { session });
        } catch (error) {
          logoutFailure = `Sensor updated, but failed to close the API session: ${describeGatewayError(error)}`;
        }
      }
      if (logoutFailure) {
        setSubmitError(logoutFailure);
      }
      setBusy(false);
    }
  };

  return (
    <div style={pageStyle}>
      <header style={heroStyle}>
        <div>
          <h1 style={heroTitleStyle}>Multitech Sensor Onboarding</h1>
          <p style={heroSubtitleStyle}>Connect, scan, review, and onboard a sensor.</p>
        </div>
      </header>

      <section style={cardStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>Connect to gateway</h2>
          <div style={indicatorPillStyle}>
            <span
              style={{
                ...indicatorDotStyle,
                background: disconnectingGateway
                  ? "#f59e0b"
                  : testingGateway
                    ? "#f59e0b"
                    : gatewayConnected
                      ? "#22c55e"
                      : "#94a3b8",
              }}
            />
            <span>
              {disconnectingGateway
                ? "Disconnecting"
                : testingGateway
                  ? "Checking"
                  : gatewayConnected
                    ? "Connected"
                    : "Not connected"}
            </span>
          </div>
        </div>

        <label style={labelStyle}>Gateway address</label>
        <div style={addressRowStyle}>
          <select
            value={gatewayScheme}
            onChange={(event) => setGatewayScheme(event.target.value as GatewayScheme)}
            style={{ ...inputStyle, width: 104, flexShrink: 0 }}
            disabled={/^https?:\/\//i.test(gatewayBase.trim())}
          >
            <option value="https">HTTPS</option>
            <option value="http">HTTP</option>
          </select>
          <input
            value={gatewayBase}
            onChange={(event) => setGatewayBase(event.target.value)}
            list={gatewayDatalistId}
            placeholder="192.168.2.1"
            style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            autoComplete="off"
          />
        </div>
        <datalist id={gatewayDatalistId}>
          {recentGateways.map((gateway) => (
            <option key={gateway} value={gateway} />
          ))}
        </datalist>

        <div style={twoColumnGridStyle}>
          <div>
            <label style={labelStyle}>Username</label>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              style={inputStyle}
              autoComplete="username"
            />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={inputStyle}
              autoComplete="current-password"
            />
          </div>
        </div>

        {showHostedProxyFields && (
          <div style={{ marginTop: "0.9rem" }}>
            <label style={labelStyle}>Local proxy URL</label>
            <input
              value={proxyBaseUrl}
              onChange={(event) => setProxyBaseUrl(event.target.value)}
              placeholder="http://192.168.0.10:3000"
              style={inputStyle}
              autoComplete="off"
            />
            <p style={hintStyle}>
              Required when using the hosted app from Vercel. Run <code>npm run serve:local</code> on a
              PC on the same Wi-Fi as the gateway, then enter that PC&apos;s address here.
            </p>
          </div>
        )}

        {showProxyAccessKeyField && (
          <div style={{ marginTop: "0.9rem" }}>
            <label style={labelStyle}>Proxy access key</label>
            <input
              type="password"
              value={proxyAccessKey}
              onChange={(event) => setProxyAccessKey(event.target.value)}
              style={inputStyle}
              autoComplete="off"
            />
          </div>
        )}

        <div style={buttonRowStyle}>
          <button type="button" disabled={isWorking} onClick={() => void testGateway()} style={btnSecondary}>
            {testingGateway ? "Testing..." : "Test gateway"}
          </button>
          <button type="button" disabled={isWorking} onClick={() => void disconnectGateway()} style={btnSecondary}>
            {disconnectingGateway ? "Disconnecting..." : "Disconnect gateway"}
          </button>
        </div>

        <SectionStatus success={gatewayStatus} error={gatewayError} />
        {showCorsHelp && (
          <div style={certHelpStyle}>
            <p style={{ margin: 0 }}>
              Login can succeed, but the browser blocks follow-up API calls (POST/PUT) from this hosted
              site to the gateway because of CORS. Run the local proxy on your network, enter its URL
              above, add the proxy access key if configured, then retry.
            </p>
          </div>
        )}
        {showCertHelp && (
          <div style={certHelpStyle}>
            <p style={{ margin: 0 }}>
              First-time HTTPS gateway connection may require certificate trust in the browser. Open the
              gateway directly in this same browser, accept the warning, then return here and try again.
            </p>
            <div style={buttonRowStyle}>
              <button
                type="button"
                onClick={() => window.open(resolvedBase, "_blank", "noopener,noreferrer")}
                style={btnSecondary}
              >
                Open gateway directly
              </button>
            </div>
          </div>
        )}
      </section>

      <div style={tabsRowStyle}>
        <button
          type="button"
          onClick={() => setActiveTab("single")}
          style={activeTab === "single" ? activeTabStyle : tabStyle}
        >
          Single sensor
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("import")}
          style={activeTab === "import" ? activeTabStyle : tabStyle}
        >
          Import CSV
        </button>
      </div>

      {activeTab === "single" && (
        <>
          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>QR scan</h2>
            </div>

            <div
              id={readerDomId}
              style={{
                ...scannerStyle,
                minHeight: scanning ? undefined : 136,
              }}
            />

            <div style={buttonRowStyle}>
              {!scanning ? (
                <button type="button" onClick={() => void startScanner()} style={btnPrimary}>
                  Start camera
                </button>
              ) : (
                <button type="button" onClick={() => void stopScanner()} style={btnSecondary}>
                  Stop camera
                </button>
              )}
            </div>

            <label style={labelStyle}>Paste QR text</label>
            <textarea
              value={rawQrPayload}
              onChange={(event) => setRawQrPayload(event.target.value)}
              placeholder="7894E80000057DEF:BBC7874F37721B429226A6016AE0C50A:7894E80000000000:RBS3010NA01BN00:23412332"
              style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
              spellCheck={false}
            />

            <div style={buttonRowStyle}>
              <button type="button" onClick={parseManualQr} style={btnSecondary}>
                Parse pasted QR text
              </button>
            </div>

            <SectionStatus success={qrStatus} error={qrError} />
          </section>

          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>Sensor details</h2>
            </div>

            {(parsedDeviceName || parsedSerialNumber) && (
              <div style={twoColumnGridStyle}>
                <div>
                  <label style={labelStyle}>Model</label>
                  <input value={parsedDeviceName} readOnly style={readOnlyInputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Serial</label>
                  <input value={parsedSerialNumber} readOnly style={readOnlyInputStyle} />
                </div>
              </div>
            )}

            <div style={twoColumnGridStyle}>
              <div>
                <label style={labelStyle}>DevEUI</label>
                <input value={deveui} onChange={(event) => setDeveui(event.target.value)} style={inputStyle} spellCheck={false} />
              </div>
              <div>
                <label style={labelStyle}>AppEUI</label>
                <input value={appeui} onChange={(event) => setAppeui(event.target.value)} style={inputStyle} spellCheck={false} />
              </div>
            </div>

            <label style={labelStyle}>AppKey</label>
            <input value={appkey} onChange={(event) => setAppkey(event.target.value)} style={inputStyle} spellCheck={false} />

            <div style={twoColumnGridStyle}>
              <div>
                <label style={labelStyle}>Default AppEUI</label>
                <input
                  value={defaultAppeui}
                  onChange={(event) => setDefaultAppeui(event.target.value)}
                  placeholder="0011223344556677"
                  style={inputStyle}
                  spellCheck={false}
                />
              </div>
              <div>
                <label style={labelStyle}>Device class</label>
                <select value={deviceClass} onChange={(event) => setDeviceClass(event.target.value)} style={inputStyle}>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                </select>
              </div>
            </div>

            <div style={twoColumnGridStyle}>
              <div>
                <label style={labelStyle}>Device profile id</label>
                <input
                  value={deviceProfileId}
                  onChange={(event) => setDeviceProfileId(event.target.value)}
                  placeholder="LW102-OTA-US915"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Network profile id</label>
                <input
                  value={networkProfileId}
                  onChange={(event) => setNetworkProfileId(event.target.value)}
                  placeholder="DEFAULT-CLASS-A"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={toggleGroupStyle}>
              <label style={toggleLabelStyle}>
                <input type="checkbox" checked={saveAfter} onChange={(event) => setSaveAfter(event.target.checked)} />
                <span>Save configuration after add</span>
              </label>
              <label style={toggleLabelStyle}>
                <input type="checkbox" checked={restartAfter} onChange={(event) => setRestartAfter(event.target.checked)} />
                <span>Restart LoRa network server after add</span>
              </label>
              <label style={toggleLabelStyle}>
                <input
                  type="checkbox"
                  checked={enableWhitelistMode}
                  onChange={(event) => setEnableWhitelistMode(event.target.checked)}
                />
                <span>Enable local whitelist mode</span>
              </label>
            </div>

            <div style={buttonRowStyle}>
              <button type="button" disabled={isWorking} onClick={() => void submit()} style={{ ...btnPrimary, width: "100%" }}>
                {busy ? "Adding sensor..." : "Add to whitelist"}
              </button>
            </div>

            <SectionStatus success={submitStatus} error={submitError} />
          </section>
        </>
      )}

      {activeTab === "import" && (
        <>
          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <h2 style={sectionTitleStyle}>Import devices</h2>
            </div>

            <label style={labelStyle}>CSV or JSON file</label>
            <input
              type="file"
              accept=".csv,.json,application/json,text/csv"
              onChange={(event) => void handleImportFile(event)}
              style={fileInputStyle}
            />

            {importDevices.length > 0 && (
              <p style={hintStyle}>
                Ready to import {importDevices.length} device{importDevices.length === 1 ? "" : "s"}
                {importFileName ? ` from ${importFileName}` : ""}.
              </p>
            )}

            <div style={toggleGroupStyle}>
              <label style={toggleLabelStyle}>
                <input type="checkbox" checked={saveAfter} onChange={(event) => setSaveAfter(event.target.checked)} />
                <span>Save configuration after import</span>
              </label>
              <label style={toggleLabelStyle}>
                <input type="checkbox" checked={restartAfter} onChange={(event) => setRestartAfter(event.target.checked)} />
                <span>Restart LoRa network server after import</span>
              </label>
              <label style={toggleLabelStyle}>
                <input
                  type="checkbox"
                  checked={enableWhitelistMode}
                  onChange={(event) => setEnableWhitelistMode(event.target.checked)}
                />
                <span>Enable local whitelist mode</span>
              </label>
            </div>

            <div style={buttonRowStyle}>
              <button
                type="button"
                disabled={isWorking || importDevices.length === 0}
                onClick={() => void importBatch()}
                style={{ ...btnPrimary, width: "100%" }}
              >
                {importingFile ? "Importing..." : "Import devices"}
              </button>
            </div>

            <SectionStatus success={importStatus} error={importError} />
          </section>
        </>
      )}
    </div>
  );
}

const pageStyle: CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "1.5rem 1rem 3rem",
};

const heroStyle: CSSProperties = {
  marginBottom: "1rem",
  padding: "1.4rem 1.5rem",
  borderRadius: 18,
  background: "linear-gradient(135deg, #0f766e 0%, #115e59 100%)",
  color: "#fff",
  boxShadow: "0 12px 30px rgb(15 118 110 / 0.18)",
};

const heroTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "1.7rem",
  fontWeight: 700,
};

const heroSubtitleStyle: CSSProperties = {
  margin: "0.35rem 0 0",
  color: "rgb(240 253 250 / 0.92)",
};

const cardStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  padding: "1.25rem",
  marginBottom: "1rem",
  boxShadow: "0 8px 26px rgb(15 23 42 / 0.08)",
  border: "1px solid #e2e8f0",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  marginBottom: "1rem",
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "1.02rem",
  fontWeight: 700,
  color: "#0f172a",
};

const tabsRowStyle: CSSProperties = {
  display: "flex",
  gap: "0.6rem",
  margin: "0 0 1rem",
};

const tabStyle: CSSProperties = {
  padding: "0.75rem 1rem",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#334155",
  fontWeight: 700,
};

const activeTabStyle: CSSProperties = {
  ...tabStyle,
  border: "1px solid #0057b8",
  background: "#eff6ff",
  color: "#0057b8",
};

const indicatorPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.45rem",
  padding: "0.35rem 0.7rem",
  borderRadius: 999,
  background: "#f8fafc",
  border: "1px solid #dbeafe",
  color: "#334155",
  fontSize: "0.82rem",
  fontWeight: 600,
};

const indicatorDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  display: "inline-block",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: "0.35rem",
  fontSize: "0.85rem",
  fontWeight: 600,
  color: "#334155",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "0.65rem 0.75rem",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
};

const fileInputStyle: CSSProperties = {
  ...inputStyle,
  padding: "0.5rem",
};

const readOnlyInputStyle: CSSProperties = {
  ...inputStyle,
  color: "#475569",
  background: "#f1f5f9",
};

const addressRowStyle: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  alignItems: "stretch",
};

const twoColumnGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "0.75rem",
  marginTop: "0.9rem",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  marginTop: "0.85rem",
  flexWrap: "wrap",
};

const hintStyle: CSSProperties = {
  margin: "0.85rem 0 0",
  color: "#475569",
  fontSize: "0.9rem",
};

const scannerStyle: CSSProperties = {
  borderRadius: 12,
  overflow: "hidden",
  background: "#e2e8f0",
  border: "1px solid #cbd5e1",
};

const toggleGroupStyle: CSSProperties = {
  display: "grid",
  gap: "0.5rem",
  marginTop: "0.95rem",
};

const toggleLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.6rem",
  fontSize: "0.92rem",
  color: "#334155",
};

const btnPrimary: CSSProperties = {
  padding: "0.7rem 1rem",
  borderRadius: 10,
  border: "none",
  background: "#0057b8",
  color: "#fff",
  fontWeight: 700,
};

const btnSecondary: CSSProperties = {
  ...btnPrimary,
  background: "#003f88",
};

const statusSuccessStyle: CSSProperties = {
  margin: "0.9rem 0 0",
  padding: "0.75rem 0.9rem",
  borderRadius: 10,
  background: "#ecfdf5",
  border: "1px solid #a7f3d0",
  color: "#166534",
  fontSize: "0.92rem",
};

const statusErrorStyle: CSSProperties = {
  ...statusSuccessStyle,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#b91c1c",
};

const certHelpStyle: CSSProperties = {
  marginTop: "0.75rem",
  padding: "0.85rem 0.9rem",
  borderRadius: 10,
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  color: "#1e3a8a",
  fontSize: "0.92rem",
};
