import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "prd.html");
    const html = await readFile(filePath, "utf8");

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return new Response(
      `<html><body><h1>PRD not found</h1><p>${String(error?.message || "Unable to read prd.html.")}</p></body></html>`,
      {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      }
    );
  }
}
