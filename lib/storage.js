const DEFAULT_BUCKET = "fresh-take-gantt";
let bucketReadyPromise = null;

function getStorageConfig() {
  const baseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!baseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  return {
    baseUrl,
    serviceRoleKey,
    bucketName: String(process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET,
  };
}

function encodeObjectPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function parseError(response) {
  const text = await response.text();

  try {
    const payload = JSON.parse(text);
    return payload.message || payload.error || text || `Request failed with ${response.status}`;
  } catch {
    return text || `Request failed with ${response.status}`;
  }
}

async function storageRequest(path, options = {}, allowFailure = false) {
  const { baseUrl, serviceRoleKey } = getStorageConfig();
  const response = await fetch(`${baseUrl}/storage/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(options.headers || {}),
    },
    body: options.body,
    cache: "no-store",
  });

  if (!response.ok && !allowFailure) {
    throw new Error(await parseError(response));
  }

  return response;
}

export async function ensureBucket() {
  if (bucketReadyPromise) {
    return bucketReadyPromise;
  }

  const { bucketName } = getStorageConfig();

  bucketReadyPromise = (async () => {
    const response = await storageRequest(
      "bucket",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: bucketName,
          name: bucketName,
          public: false,
        }),
      },
      true
    );

    if (response.ok) {
      return;
    }

    const message = await parseError(response);
    const normalized = message.toLowerCase();

    if ((response.status === 400 || response.status === 409) && normalized.includes("already")) {
      return;
    }

    throw new Error(message);
  })().catch((error) => {
    bucketReadyPromise = null;
    throw error;
  });

  return bucketReadyPromise;
}

export async function readJsonObject(objectPath) {
  const { bucketName } = getStorageConfig();
  await ensureBucket();

  const response = await storageRequest(
    `object/authenticated/${bucketName}/${encodeObjectPath(objectPath)}`,
    {},
    true
  );

  if (!response.ok) {
    const message = await parseError(response);
    if (message.toLowerCase().includes("object not found")) {
      return null;
    }

    throw new Error(message);
  }

  return response.json();
}

export async function writeJsonObject(objectPath, payload) {
  const { bucketName } = getStorageConfig();
  await ensureBucket();

  const response = await storageRequest(
    `object/${bucketName}/${encodeObjectPath(objectPath)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-upsert": "true",
      },
      body: JSON.stringify(payload),
    },
    true
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
}
