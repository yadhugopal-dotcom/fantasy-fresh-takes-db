import { google } from "googleapis";

export const GOOGLE_SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const GOOGLE_SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const GOOGLE_DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function getGoogleServiceAccountCredentials() {
  const rawValue = String(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").trim();

  if (!rawValue) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY in the server environment.");
  }

  let credentials = null;

  try {
    credentials = JSON.parse(rawValue);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY must be a valid JSON string.");
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email or private_key.");
  }

  return {
    ...credentials,
    private_key: String(credentials.private_key).replace(/\\n/g, "\n"),
  };
}

export function createGoogleAuth(scopes = []) {
  return new google.auth.GoogleAuth({
    credentials: getGoogleServiceAccountCredentials(),
    scopes,
  });
}

export function createGoogleSheetsClient(scopes = [GOOGLE_SHEETS_READONLY_SCOPE]) {
  return google.sheets({
    version: "v4",
    auth: createGoogleAuth(scopes),
  });
}

export function createGoogleSheetsWriteClient() {
  return google.sheets({
    version: "v4",
    auth: createGoogleAuth([GOOGLE_SHEETS_WRITE_SCOPE]),
  });
}

export function createGoogleDriveClient(scopes = [GOOGLE_DRIVE_READONLY_SCOPE]) {
  return google.drive({
    version: "v3",
    auth: createGoogleAuth(scopes),
  });
}
