function queryFromSearchParams(searchParams) {
  const query = {};

  for (const key of searchParams.keys()) {
    const values = searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0] || "";
  }

  return query;
}

async function readRequestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      return await request.json();
    } catch {
      return {};
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(await request.text());
    return Object.fromEntries(params.entries());
  }

  if (contentType.includes("text/")) {
    return await request.text();
  }

  return undefined;
}

export async function runLegacyHandler(handler, request) {
  const url = new URL(request.url);
  const body = await readRequestBody(request);
  const headers = {};

  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  if (!headers.host) {
    headers.host = url.host;
  }

  let statusCode = 200;
  let responseBody = "";
  const responseHeaders = new Headers();

  const req = {
    method: request.method,
    query: queryFromSearchParams(url.searchParams),
    body,
    headers,
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(name, value) {
      responseHeaders.set(name, String(value));
      return this;
    },
    send(payload) {
      responseBody =
        typeof payload === "string" || payload instanceof Uint8Array ? payload : JSON.stringify(payload);
      return this;
    },
  };

  await handler(req, res);

  return new Response(responseBody, {
    status: statusCode,
    headers: responseHeaders,
  });
}
