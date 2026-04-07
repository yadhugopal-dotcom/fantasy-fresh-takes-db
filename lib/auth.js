import crypto from "node:crypto";

const EDIT_COOKIE = "fresh_take_edit";
const EDIT_SESSION_KEY = "fresh-take-gantt-editor";
const FIXED_EDIT_PASSWORD = "PocketFM@123";

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) {
          return [part, ""];
        }

        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

function valuesMatch(expected, received) {
  const expectedBuffer = Buffer.from(String(expected || ""));
  const receivedBuffer = Buffer.from(String(received || ""));

  if (!expectedBuffer.length || expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function getEditPassword() {
  return FIXED_EDIT_PASSWORD;
}

function getSessionSecret() {
  return String(process.env.EDIT_SESSION_SECRET || "").trim() || getEditPassword();
}

function getSignedSessionValue() {
  return crypto.createHmac("sha256", getSessionSecret()).update(EDIT_SESSION_KEY).digest("hex");
}

export function isEditPasswordConfigured() {
  return Boolean(getEditPassword());
}

export function matchesEditPassword(candidate) {
  return valuesMatch(getEditPassword(), String(candidate || ""));
}

export function hasEditSession(request) {
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const cookieValue = cookies[EDIT_COOKIE];

  if (!cookieValue) {
    return false;
  }

  return valuesMatch(getSignedSessionValue(), cookieValue);
}

export function setEditSession(response) {
  response.cookies.set(EDIT_COOKIE, getSignedSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export function clearEditSession(response) {
  response.cookies.set(EDIT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
