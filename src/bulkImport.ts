import type { WhitelistDeviceBody } from "./gatewayApi";
import { normalizeHex } from "./parseQr";

type ParseResult = {
  devices: WhitelistDeviceBody[];
  source: "json" | "csv";
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function validateDevice(
  input: Record<string, unknown>,
  index: number,
): WhitelistDeviceBody {
  const deveui = normalizeHex(String(input.deveui ?? ""));
  const appeui = normalizeHex(String(input.appeui ?? ""));
  const appkey = normalizeHex(String(input.appkey ?? ""));
  const deviceClass = String(input.class ?? "A").trim().toUpperCase();
  const deviceProfileId = String(input.device_profile_id ?? "").trim();
  const networkProfileId = String(input.network_profile_id ?? "").trim();

  if (deveui.length !== 16) {
    throw new Error(`Row ${index + 1}: DevEUI must be 16 hex characters.`);
  }

  if (appeui.length !== 16) {
    throw new Error(`Row ${index + 1}: AppEUI must be 16 hex characters.`);
  }

  if (appkey.length !== 32) {
    throw new Error(`Row ${index + 1}: AppKey must be 32 hex characters.`);
  }

  if (!["A", "B", "C"].includes(deviceClass)) {
    throw new Error(`Row ${index + 1}: class must be A, B, or C.`);
  }

  return {
    deveui,
    appeui,
    appkey,
    class: deviceClass,
    ...(deviceProfileId ? { device_profile_id: deviceProfileId } : {}),
    ...(networkProfileId ? { network_profile_id: networkProfileId } : {}),
  };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text: string): WhitelistDeviceBody[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV file must include a header row and at least one device row.");
  }

  const headers = parseCsvLine(lines[0]).map(normalizeKey);
  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const record = headers.reduce<Record<string, string>>((accumulator, header, headerIndex) => {
      accumulator[header] = values[headerIndex] ?? "";
      return accumulator;
    }, {});
    return validateDevice(record, index);
  });
}

function parseJson(text: string): WhitelistDeviceBody[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("JSON import must be an array of device objects.");
  }

  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Row ${index + 1}: each JSON entry must be an object.`);
    }

    const normalized = Object.entries(item).reduce<Record<string, unknown>>((accumulator, [key, value]) => {
      accumulator[normalizeKey(key)] = value;
      return accumulator;
    }, {});

    return validateDevice(normalized, index);
  });
}

export function parseDeviceImport(fileName: string, text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("The selected file is empty.");
  }

  const lowerFileName = fileName.toLowerCase();
  const looksLikeJson = lowerFileName.endsWith(".json") || trimmed.startsWith("[");
  const devices = looksLikeJson ? parseJson(trimmed) : parseCsv(trimmed);

  if (devices.length === 0) {
    throw new Error("No devices were found in the selected file.");
  }

  return {
    devices,
    source: looksLikeJson ? "json" : "csv",
  };
}
