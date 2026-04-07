import { NextResponse } from "next/server";
import { hasEditSession } from "../../../lib/auth.js";
import { readJsonObject, writeJsonObject } from "../../../lib/storage.js";
import {
  buildCommittedWeekSnapshot,
  createDefaultWriterConfig,
  getCurrentWeekKey,
  mergeWeekData,
  mergeWriterConfig,
  serializeWeekData,
} from "../../../lib/tracker-data.js";

const CONFIG_PATH = "config/writer-config.json";

function getWeekPath(weekKey) {
  return `weeks/${weekKey}.json`;
}

function getCommittedWeekPath(weekKey) {
  return `weeks/${weekKey}-committed.json`;
}

function getCommittedSnapshotMeta(storedSnapshot) {
  if (!storedSnapshot || typeof storedSnapshot !== "object") {
    return null;
  }

  const snapshotTimestamp =
    typeof storedSnapshot.snapshotTimestamp === "string" && storedSnapshot.snapshotTimestamp.trim()
      ? storedSnapshot.snapshotTimestamp
      : typeof storedSnapshot.updatedAt === "string" && storedSnapshot.updatedAt.trim()
        ? storedSnapshot.updatedAt
        : null;

  return snapshotTimestamp
    ? {
        snapshotTimestamp,
        totalCommittedRows: Number(storedSnapshot?.summary?.totalCommittedRows || storedSnapshot?.committedRows?.length || 0),
      }
    : null;
}

function getCommittedSnapshotData(storedSnapshot) {
  if (!storedSnapshot || typeof storedSnapshot !== "object") {
    return null;
  }

  return {
    weekKey: normalizeWeekKey(storedSnapshot.weekKey),
    snapshotTimestamp:
      typeof storedSnapshot.snapshotTimestamp === "string" && storedSnapshot.snapshotTimestamp.trim()
        ? storedSnapshot.snapshotTimestamp
        : null,
    rosterSnapshot: storedSnapshot.rosterSnapshot && typeof storedSnapshot.rosterSnapshot === "object" ? storedSnapshot.rosterSnapshot : null,
    weekData: storedSnapshot.weekData && typeof storedSnapshot.weekData === "object" ? storedSnapshot.weekData : null,
  };
}

function normalizeWeekKey(value) {
  const weekKey = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(weekKey) ? weekKey : "";
}

async function loadWriterConfig() {
  const storedConfig = await readJsonObject(CONFIG_PATH);
  return mergeWriterConfig(storedConfig || createDefaultWriterConfig());
}

export async function GET(request) {
  const weekKey = normalizeWeekKey(new URL(request.url).searchParams.get("week"));

  if (!weekKey) {
    return NextResponse.json({ error: "A valid week query string is required." }, { status: 400 });
  }

  try {
    const writerConfig = await loadWriterConfig();
    const [storedWeek, committedSnapshot] = await Promise.all([
      readJsonObject(getWeekPath(weekKey)),
      readJsonObject(getCommittedWeekPath(weekKey)),
    ]);
    const weekData = mergeWeekData(writerConfig, storedWeek, weekKey);

    return NextResponse.json({
      weekData,
      updatedAt: storedWeek?.updatedAt || null,
      committedSnapshot: getCommittedSnapshotMeta(committedSnapshot),
      committedSnapshotData: getCommittedSnapshotData(committedSnapshot),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to load this week." }, { status: 500 });
  }
}

export async function PUT(request) {
  const weekKey = normalizeWeekKey(new URL(request.url).searchParams.get("week"));

  if (!weekKey) {
    return NextResponse.json({ error: "A valid week query string is required." }, { status: 400 });
  }

  if (!hasEditSession(request)) {
    return NextResponse.json({ error: "Unlock edit mode before saving changes." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const requestedWriterConfig = body.writerConfig ? mergeWriterConfig(body.writerConfig) : null;
    const writerConfig = requestedWriterConfig || (await loadWriterConfig());
    const requestedWeekData = body.weekData || body;
    const rosterConfig =
      weekKey < getCurrentWeekKey() && requestedWeekData?.rosterSnapshot
        ? mergeWriterConfig(requestedWeekData.rosterSnapshot)
        : writerConfig;
    const weekData = serializeWeekData(rosterConfig, requestedWeekData, weekKey);
    const payload = {
      updatedAt: new Date().toISOString(),
      ...weekData,
    };

    await writeJsonObject(getWeekPath(weekKey), payload);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to save this week." }, { status: 500 });
  }
}

export async function POST(request) {
  const weekKey = normalizeWeekKey(new URL(request.url).searchParams.get("week"));

  if (!weekKey) {
    return NextResponse.json({ error: "A valid week query string is required." }, { status: 400 });
  }

  if (!hasEditSession(request)) {
    return NextResponse.json({ error: "Unlock edit mode before committing this plan." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const requestedWriterConfig = body.writerConfig ? mergeWriterConfig(body.writerConfig) : null;
    const writerConfig = requestedWriterConfig || (await loadWriterConfig());
    const requestedWeekData = body.weekData || body;
    const rosterConfig =
      weekKey < getCurrentWeekKey() && requestedWeekData?.rosterSnapshot
        ? mergeWriterConfig(requestedWeekData.rosterSnapshot)
        : writerConfig;
    const snapshotTimestamp = new Date().toISOString();
    const committedSnapshot = buildCommittedWeekSnapshot(rosterConfig, requestedWeekData, weekKey, {
      snapshotTimestamp,
    });
    const payload = {
      updatedAt: snapshotTimestamp,
      ...committedSnapshot,
    };

    await writeJsonObject(getCommittedWeekPath(weekKey), payload);

    return NextResponse.json({
      ok: true,
      committedSnapshot: getCommittedSnapshotMeta(payload),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Unable to commit this week plan." }, { status: 500 });
  }
}
