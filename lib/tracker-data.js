export const POD_BLUEPRINTS = [
  { id: "dan", cl: "Dan", color: "#1e3a5f", defaultWriters: ["Writer D1", "Writer D2", "Writer D3"] },
  { id: "paul", cl: "Paul", color: "#1e40af", defaultWriters: ["Writer P1", "Writer P2", "Writer P3", "Writer P4"] },
  { id: "josh", cl: "Josh", color: "#5b21b6", defaultWriters: ["Writer J1", "Writer J2", "Writer J3", "Writer J4"] },
  { id: "nishant", cl: "Nishant", color: "#0d9488", defaultWriters: ["Writer N1", "Writer N2", "Writer N3"] },
];
export const WRITER_ROLE_OPTIONS = ["Senior Writer", "Writer", "Pod Lead"];
export const HIDDEN_POD_LEAD_NAMES = new Set([]);
export const NON_BAU_POD_LEAD_NAMES = new Set(["dan"]);

export const STAGES = [
  { id: "beats_ideation", label: "Beats ideation", color: "#64748b", bg: "#e2e8f0", text: "#334155" },
  { id: "writing", label: "Writing", color: "#3b82f6", bg: "#dbeafe", text: "#1e40af" },
  { id: "cl_review", label: "CL review", color: "#8b5cf6", bg: "#ede9fe", text: "#5b21b6" },
  { id: "production", label: "Production", color: "#10b981", bg: "#d1fae5", text: "#065f46" },
  { id: "live_on_meta", label: "Live on Meta", color: "#06b6d4", bg: "#cffafe", text: "#155e75" },
  { id: "writer_ooo", label: "Writer OOO", color: "#f59e0b", bg: "#fef3c7", text: "#92400e" },
];

export const STAGE_MAP = Object.fromEntries(STAGES.map((stage) => [stage.id, stage]));
const STAGE_INDEX_MAP = Object.fromEntries(STAGES.map((stage, index) => [stage.id, index]));
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_COUNT = DAYS.length;

const LEGACY_STAGE_ALIASES = new Map(
  [
    ["beats ideation", "beats_ideation"],
    ["beats_ideation", "beats_ideation"],
    ["ideation", "beats_ideation"],
    ["writing", "writing"],
    ["cl review", "cl_review"],
    ["cl_review", "cl_review"],
    ["clreview", "cl_review"],
    ["submitted", "production"],
    ["production", "production"],
    ["canvas locked", "production"],
    ["canvas_locked", "production"],
    ["live on meta", "live_on_meta"],
    ["live_on_meta", "live_on_meta"],
    ["live in meta", "live_on_meta"],
    ["live_in_meta", "live_on_meta"],
    ["live", "live_on_meta"],
    ["writer ooo", "writer_ooo"],
    ["writer_ooo", "writer_ooo"],
    ["ooo", "writer_ooo"],
  ]
);

function writerIdFor(podId, index) {
  return `${podId}-writer-${index + 1}`;
}

export function getBeatId(writerId, beatNum) {
  return `${writerId}-beat-${beatNum}`;
}

function defaultAssetId(beatId, assetIndex) {
  return `${beatId}-asset-${assetIndex + 1}`;
}

function normalizeDisplayOrder(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeActive(value) {
  return value !== false;
}

function normalizeWriterRole(value, fallback = "Writer") {
  const normalized = String(value || fallback).trim();
  return WRITER_ROLE_OPTIONS.includes(normalized) ? normalized : fallback;
}

function normalizeStageKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizeStageId(value) {
  const stageKey = normalizeStageKey(value);
  if (!stageKey) {
    return null;
  }

  if (LEGACY_STAGE_ALIASES.has(stageKey)) {
    return LEGACY_STAGE_ALIASES.get(stageKey);
  }

  if (stageKey.includes("live")) {
    return "live_on_meta";
  }

  if (stageKey.includes("canvas") || stageKey.includes("submitted") || stageKey.includes("production")) {
    return "production";
  }

  if (stageKey.includes("cl")) {
    return "cl_review";
  }

  if (stageKey.includes("write")) {
    return "writing";
  }

  if (stageKey.includes("ideation")) {
    return "beats_ideation";
  }

  if (stageKey.includes("ooo")) {
    return "writer_ooo";
  }

  return null;
}

export function isVisiblePlannerPodLeadName(value) {
  return !HIDDEN_POD_LEAD_NAMES.has(String(value || "").trim().toLowerCase());
}

export function isNonBauPodLeadName(value) {
  return NON_BAU_POD_LEAD_NAMES.has(String(value || "").trim().toLowerCase());
}

function sortByDisplayOrder(rows) {
  return [...rows].sort((a, b) => {
    const diff = normalizeDisplayOrder(a.displayOrder, 0) - normalizeDisplayOrder(b.displayOrder, 0);
    if (diff !== 0) {
      return diff;
    }

    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function normalizeWriter(writer = {}, podId, index, fallback = {}) {
  return {
    id:
      typeof writer.id === "string" && writer.id.trim()
        ? writer.id
        : typeof fallback.id === "string" && fallback.id.trim()
          ? fallback.id
          : writerIdFor(podId, index),
    name:
      typeof writer.name === "string" && writer.name.trim()
        ? writer.name
        : typeof fallback.name === "string"
          ? fallback.name
          : `Writer ${index + 1}`,
    role: normalizeWriterRole(writer.role, normalizeWriterRole(fallback.role, "Writer")),
    displayOrder: normalizeDisplayOrder(writer.displayOrder, normalizeDisplayOrder(fallback.displayOrder, index)),
    active: normalizeActive(writer.active ?? fallback.active),
  };
}

function normalizePod(pod = {}, index, fallback = {}) {
  const podId =
    typeof pod.id === "string" && pod.id.trim()
      ? pod.id
      : typeof fallback.id === "string" && fallback.id.trim()
        ? fallback.id
        : `pod-${index + 1}`;
  const fallbackWriters = Array.isArray(fallback.writers) ? fallback.writers : [];
  const sourceWriters = Array.isArray(pod.writers) && pod.writers.length > 0 ? pod.writers : fallbackWriters;

  return {
    id: podId,
    cl:
      typeof pod.cl === "string" && pod.cl.trim()
        ? pod.cl
        : typeof fallback.cl === "string" && fallback.cl.trim()
          ? fallback.cl
          : `Pod ${index + 1}`,
    color:
      typeof pod.color === "string" && pod.color.trim()
        ? pod.color
        : typeof fallback.color === "string" && fallback.color.trim()
          ? fallback.color
          : "#1e293b",
    displayOrder: normalizeDisplayOrder(pod.displayOrder, normalizeDisplayOrder(fallback.displayOrder, index)),
    active: normalizeActive(pod.active ?? fallback.active),
    writers: sortByDisplayOrder(
      sourceWriters.map((writer, writerIndex) =>
        normalizeWriter(writer, podId, writerIndex, fallbackWriters[writerIndex] || {})
      )
    ),
  };
}

function getRosterSnapshot(writerConfig) {
  const pods = sortByDisplayOrder(Array.isArray(writerConfig?.pods) ? writerConfig.pods : [])
    .filter((pod) => normalizeActive(pod.active))
    .map((pod, podIndex) => {
      const writers = sortByDisplayOrder(Array.isArray(pod.writers) ? pod.writers : [])
        .filter((writer) => normalizeActive(writer.active))
        .map((writer, writerIndex) => ({
          id: writer.id,
          name: writer.name,
          role: normalizeWriterRole(writer.role, "Writer"),
          displayOrder: normalizeDisplayOrder(writer.displayOrder, writerIndex),
          active: true,
        }));

      return {
        id: pod.id,
        cl: pod.cl,
        color: pod.color,
        displayOrder: normalizeDisplayOrder(pod.displayOrder, podIndex),
        active: true,
        writers,
      };
    })
    .filter((pod) => pod.writers.length > 0);

  return {
    version: 2,
    pods,
  };
}

function buildWeekBeatsFromRoster(writerConfig) {
  const beats = {};
  const roster = getRosterSnapshot(writerConfig);

  roster.pods.forEach((pod) => {
    pod.writers.forEach((writer) => {
      [1, 2].forEach((beatNum) => {
        const beatId = getBeatId(writer.id, beatNum);
        beats[beatId] = createDefaultBeatRecord(beatId, beatNum);
      });
    });
  });

  return {
    rosterSnapshot: roster,
    beats,
  };
}

function createDefaultAsset(beatId, assetIndex = 0) {
  return {
    id: defaultAssetId(beatId, assetIndex),
    assetCode: "",
    days: Array(DAY_COUNT).fill(null),
  };
}

export function createDefaultBeatRecord(beatId, beatNum) {
  return {
    id: beatId,
    beatNum,
    showName: "",
    beatTitle: "",
    beatDocUrl: "",
    sheetRowId: "",
    assets: [createDefaultAsset(beatId, 0)],
  };
}

export function sanitizeDays(days) {
  return Array.from({ length: DAY_COUNT }, (_, index) => {
    const value = Array.isArray(days) ? days[index] : null;
    const normalizedStageId = normalizeStageId(value);
    return normalizedStageId && STAGE_MAP[normalizedStageId] ? normalizedStageId : null;
  });
}

function sanitizeAsset(asset, beatId, assetIndex) {
  return {
    id:
      typeof asset?.id === "string" && asset.id.trim()
        ? asset.id
        : defaultAssetId(beatId, assetIndex),
    assetCode: typeof asset?.assetCode === "string" ? asset.assetCode : "",
    days: sanitizeDays(asset?.days),
  };
}

function sanitizeBeatRecord(storedBeat, beatId, beatNum) {
  const assets = Array.isArray(storedBeat?.assets) ? storedBeat.assets.slice(0, 3) : [];

  return {
    id: beatId,
    beatNum,
    showName:
      typeof storedBeat?.showName === "string"
        ? storedBeat.showName
        : typeof storedBeat?.show === "string"
          ? storedBeat.show
          : "",
    beatTitle:
      typeof storedBeat?.beatTitle === "string"
        ? storedBeat.beatTitle
        : typeof storedBeat?.beatName === "string"
          ? storedBeat.beatName
          : "",
    beatDocUrl:
      typeof storedBeat?.beatDocUrl === "string"
        ? storedBeat.beatDocUrl
        : typeof storedBeat?.googleDoc === "string"
          ? storedBeat.googleDoc
          : "",
    sheetRowId: typeof storedBeat?.sheetRowId === "string" ? storedBeat.sheetRowId : "",
    assets: assets.length
      ? assets.map((asset, assetIndex) => sanitizeAsset(asset, beatId, assetIndex))
      : [
          storedBeat && Array.isArray(storedBeat?.days)
            ? {
                id: defaultAssetId(beatId, 0),
                assetCode: typeof storedBeat?.assetCode === "string" ? storedBeat.assetCode : "",
                days: sanitizeDays(storedBeat.days),
              }
            : createDefaultAsset(beatId, 0),
        ],
  };
}

export function createDefaultWriterConfig() {
  return {
    version: 2,
    pods: POD_BLUEPRINTS.map((pod, podIndex) =>
      normalizePod(
        {
          ...pod,
          displayOrder: podIndex,
          active: true,
          writers: pod.defaultWriters.map((name, writerIndex) => ({
            id: writerIdFor(pod.id, writerIndex),
            name,
            role: "Writer",
            displayOrder: writerIndex,
            active: true,
          })),
        },
        podIndex
      )
    ),
  };
}

export function mergeWriterConfig(storedConfig) {
  const defaults = createDefaultWriterConfig();
  const storedPods = Array.isArray(storedConfig?.pods) ? storedConfig.pods : [];
  const sourcePods = storedPods.length > 0 ? storedPods : defaults.pods;

  return {
    version: 2,
    pods: sortByDisplayOrder(
      sourcePods.map((pod, podIndex) => {
        const fallbackPod =
          defaults.pods.find((candidate) => candidate.id === pod?.id) || defaults.pods[podIndex] || {};
        return normalizePod(pod, podIndex, fallbackPod);
      })
    ),
  };
}

export function createDefaultWeekData(writerConfig, weekKey = "") {
  const { rosterSnapshot, beats } = buildWeekBeatsFromRoster(writerConfig);

  return {
    weekKey,
    rosterSnapshot,
    beats,
  };
}

export function mergeWeekData(writerConfig, storedWeek, weekKey = "") {
  const rosterSource = storedWeek?.rosterSnapshot ? mergeWriterConfig(storedWeek.rosterSnapshot) : writerConfig;
  const base = createDefaultWeekData(rosterSource, weekKey);
  const legacyBeats = Array.isArray(storedWeek?.beats) ? storedWeek.beats : null;
  const storedBeats =
    storedWeek?.beats && typeof storedWeek.beats === "object" && !Array.isArray(storedWeek.beats)
      ? storedWeek.beats
      : {};
  const orderedLegacyBeats = legacyBeats ? legacyBeats.slice() : [];
  let legacyIndex = 0;

  Object.keys(base.beats).forEach((beatId) => {
    const storedBeat = storedBeats[beatId] || orderedLegacyBeats[legacyIndex] || null;
    const beatNum = base.beats[beatId].beatNum;
    base.beats[beatId] = sanitizeBeatRecord(storedBeat, beatId, beatNum);

    legacyIndex += 1;
  });

  // Preserve any extra beats from stored data (beat 3, 4, etc.)
  for (const [storedBeatId, storedBeat] of Object.entries(storedBeats)) {
    if (base.beats[storedBeatId]) continue;
    const writerMatch = storedBeatId.match(/^(.+)-beat-(\d+)$/);
    if (!writerMatch) continue;
    const beatNum = Number(writerMatch[2]);
    base.beats[storedBeatId] = sanitizeBeatRecord(storedBeat, storedBeatId, beatNum);
  }

  const removedBeats = Array.isArray(storedWeek?.removedBeats) ? storedWeek.removedBeats : [];
  for (const beatId of removedBeats) {
    delete base.beats[beatId];
  }

  return {
    weekKey: weekKey || storedWeek?.weekKey || "",
    rosterSnapshot: base.rosterSnapshot,
    beats: base.beats,
    removedBeats,
  };
}

export function buildPodsModel(writerConfig, weekData) {
  const roster = getRosterSnapshot(writerConfig);
  const beats =
    weekData?.beats && typeof weekData.beats === "object" && !Array.isArray(weekData.beats) ? weekData.beats : {};
  const removedBeats = new Set(Array.isArray(weekData?.removedBeats) ? weekData.removedBeats : []);

  return roster.pods.map((pod) => ({
    ...pod,
    writers: pod.writers.map((writer) => ({
      ...writer,
      beats: (() => {
        const beatNums = [1, 2];
        const beatPrefix = `${writer.id}-beat-`;
        for (const key of Object.keys(beats)) {
          if (key.startsWith(beatPrefix)) {
            const num = Number(key.slice(beatPrefix.length));
            if (Number.isInteger(num) && !beatNums.includes(num)) {
              beatNums.push(num);
            }
          }
        }
        beatNums.sort((a, b) => a - b);
        const activeBeatNums = beatNums.filter((num) => !removedBeats.has(getBeatId(writer.id, num)));
        const finalBeatNums = activeBeatNums.length > 0 ? activeBeatNums : [beatNums[0]];
        return finalBeatNums.map((beatNum) => {
          const beatId = getBeatId(writer.id, beatNum);
          const beat = sanitizeBeatRecord(beats[beatId], beatId, beatNum);
          return { ...beat, beatNum };
        });
      })(),
    })),
  }));
}

export function summarizeAssetsFromPods(pods) {
  const summary = Object.fromEntries(STAGES.map((stage) => [stage.id, 0]));
  let notStarted = 0;

  const allAssets = pods.flatMap((pod) =>
    pod.writers.flatMap((writer) => writer.beats.flatMap((beat) => beat.assets))
  );

  allAssets.forEach((asset) => {
    const latestStage = [...asset.days].reverse().find((value) => value !== null);
    if (latestStage) {
      summary[latestStage] += 1;
      return;
    }

    notStarted += 1;
  });

  return { summary, notStarted, allAssets };
}

export function countAllAssetsWithStage(pods, targetStageId) {
  let count = 0;
  for (const pod of Array.isArray(pods) ? pods : []) {
    for (const writer of Array.isArray(pod?.writers) ? pod.writers : []) {
      for (const beat of Array.isArray(writer?.beats) ? writer.beats : []) {
        for (const asset of Array.isArray(beat?.assets) ? beat.assets : []) {
          if ((Array.isArray(asset?.days) ? asset.days : []).some((v) => normalizeStageId(v) === targetStageId)) {
            count += 1;
          }
        }
      }
    }
  }
  return count;
}

export function countActiveWritersInPods(pods) {
  const writers = new Set();
  for (const pod of Array.isArray(pods) ? pods : []) {
    for (const writer of Array.isArray(pod?.writers) ? pod.writers : []) {
      const name = String(writer?.name || "").trim().toLowerCase();
      if (name) writers.add(name);
    }
  }
  return writers.size;
}

export function serializeWriterConfig(writerConfig) {
  return mergeWriterConfig(writerConfig);
}

export function serializeWeekData(writerConfig, weekData, weekKey) {
  const merged = mergeWeekData(writerConfig, weekData, weekKey);
  return {
    ...merged,
    rosterSnapshot: getRosterSnapshot(writerConfig),
  };
}

function hasCommittedBeatContent(beat) {
  if (!beat || typeof beat !== "object") {
    return false;
  }

  if (String(beat.beatTitle || "").trim()) {
    return true;
  }

  if (String(beat.beatDocUrl || "").trim()) {
    return true;
  }

  if (String(beat.showName || "").trim()) {
    return true;
  }

  return Array.isArray(beat.assets)
    ? beat.assets.some((asset) => String(asset?.assetCode || "").trim())
    : false;
}

export function buildCommittedWeekSnapshot(writerConfig, weekData, weekKey, options = {}) {
  const snapshotTimestamp =
    typeof options.snapshotTimestamp === "string" && options.snapshotTimestamp.trim()
      ? options.snapshotTimestamp
      : new Date().toISOString();
  const serializedWeekData = serializeWeekData(writerConfig, weekData, weekKey);
  const snapshotConfig = mergeWriterConfig(serializedWeekData.rosterSnapshot || writerConfig);
  const pods = buildPodsModel(snapshotConfig, serializedWeekData).filter((pod) => isVisiblePlannerPodLeadName(pod?.cl));
  const committedRows = [];

  pods.forEach((pod) => {
    pod.writers.forEach((writer) => {
      writer.beats.forEach((beat) => {
        if (!hasCommittedBeatContent(beat)) {
          return;
        }

        committedRows.push({
          beatId: beat.id,
          beatNum: beat.beatNum,
          beatTitle: String(beat.beatTitle || ""),
          beatDocUrl: String(beat.beatDocUrl || ""),
          showName: String(beat.showName || ""),
          pod_lead: String(pod.cl || ""),
          writer_name: String(writer.name || ""),
          role: normalizeWriterRole(writer.role, "Writer"),
          assetCodes: Array.isArray(beat.assets)
            ? beat.assets.map((asset) => String(asset?.assetCode || "").trim()).filter(Boolean)
            : [],
          weekKey: String(weekKey || ""),
          snapshotTimestamp,
        });
      });
    });
  });

  const podCounts = Object.fromEntries(
    pods.map((pod) => [
      pod.cl,
      committedRows.filter((row) => row.pod_lead === pod.cl).length,
    ])
  );

  return {
    version: 1,
    weekKey: String(weekKey || ""),
    snapshotTimestamp,
    committedRows,
    rosterSnapshot: serializedWeekData.rosterSnapshot,
    weekData: serializedWeekData,
    summary: {
      totalCommittedRows: committedRows.length,
      podCounts,
    },
  };
}

export function getAssetLatestStage(asset) {
  return [...(Array.isArray(asset?.days) ? asset.days : [])].reverse().find((value) => value !== null) || null;
}

export function getBeatLatestStage(beat) {
  let bestStage = null;
  let bestIndex = -1;

  for (const asset of Array.isArray(beat?.assets) ? beat.assets : []) {
    const stageId = getAssetLatestStage(asset);
    const stageIndex = Number.isInteger(STAGE_INDEX_MAP[stageId]) ? STAGE_INDEX_MAP[stageId] : -1;
    if (stageIndex > bestIndex) {
      bestStage = stageId;
      bestIndex = stageIndex;
    }
  }

  return bestStage;
}

function normalizeBeatTitleKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeBeatDocKey(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  try {
    const parsed = new URL(rawValue);
    const idMatch = parsed.pathname.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (idMatch?.[1]) {
      return idMatch[1].toLowerCase();
    }

    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return rawValue.toLowerCase();
  }
}

function getBeatIdentityKey(beat) {
  const docKey = normalizeBeatDocKey(beat?.beatDocUrl || beat?.googleDoc || "");
  if (docKey) {
    return `doc:${docKey}`;
  }

  const titleKey = normalizeBeatTitleKey(beat?.beatTitle || beat?.beatName || "");
  if (titleKey) {
    return `title:${titleKey}`;
  }

  return "";
}

function getBeatIdentityParts(beat) {
  return {
    docKey: normalizeBeatDocKey(beat?.beatDocUrl || beat?.googleDoc || ""),
    titleKey: normalizeBeatTitleKey(beat?.beatTitle || beat?.beatName || ""),
  };
}

function getBeatStageRank(stageId) {
  return Number.isInteger(STAGE_INDEX_MAP[stageId]) ? STAGE_INDEX_MAP[stageId] : -1;
}

function shouldReplaceBeatRecord(currentRecord, nextRecord) {
  if (!currentRecord) {
    return true;
  }

  const nextStageRank = getBeatStageRank(nextRecord?.latestStage);
  const currentStageRank = getBeatStageRank(currentRecord?.latestStage);
  if (nextStageRank !== currentStageRank) {
    return nextStageRank > currentStageRank;
  }

  const nextDocScore = nextRecord?.beatDocUrl ? 2 : 0;
  const currentDocScore = currentRecord?.beatDocUrl ? 2 : 0;
  const nextTitleScore = String(nextRecord?.beatTitle || "").length;
  const currentTitleScore = String(currentRecord?.beatTitle || "").length;
  const nextScore = nextDocScore + nextTitleScore;
  const currentScore = currentDocScore + currentTitleScore;

  return nextScore > currentScore;
}

export function buildPlannerBeatInventory(pods, options = {}) {
  const dedupeScope = String(options?.dedupeScope || "global").toLowerCase();
  const excludedPods = new Set(
    (Array.isArray(options?.excludePods) ? options.excludePods : [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const canonicalRecords = new Map();
  const docAliasMap = new Map();
  const titleAliasMap = new Map();
  const TITLE_AMBIGUOUS = "__ambiguous__";

  for (const pod of Array.isArray(pods) ? pods : []) {
    const podLeadName = String(pod?.cl || "").trim();
    if (!podLeadName || excludedPods.has(podLeadName.toLowerCase())) {
      continue;
    }

    for (const writer of Array.isArray(pod?.writers) ? pod.writers : []) {
      const writerName = String(writer?.name || "").trim();

      for (const beat of Array.isArray(writer?.beats) ? writer.beats : []) {
        const { docKey, titleKey } = getBeatIdentityParts(beat);
        const identityKey = docKey ? `doc:${docKey}` : titleKey ? `title:${titleKey}` : "";
        if (!identityKey || (!docKey && !titleKey)) {
          continue;
        }

        const scopePrefix =
          dedupeScope === "pod"
            ? `pod:${podLeadName.toLowerCase()}`
            : dedupeScope === "writer"
              ? `writer:${podLeadName.toLowerCase()}|${writerName.toLowerCase()}`
              : "global";
        const scopedDocKey = docKey ? `${scopePrefix}|doc:${docKey}` : "";
        const scopedTitleKey = titleKey ? `${scopePrefix}|title:${titleKey}` : "";

        const record = {
          identityKey,
          docKey,
          titleKey,
          beatId: String(beat?.id || ""),
          beatNum: Number.isFinite(Number(beat?.beatNum)) ? Number(beat.beatNum) : null,
          beatTitle: String(beat?.beatTitle || beat?.beatName || "").trim(),
          beatDocUrl: String(beat?.beatDocUrl || beat?.googleDoc || "").trim(),
          showName: String(beat?.showName || beat?.show || "").trim(),
          podLeadName,
          writerName,
          latestStage: getBeatLatestStage(beat),
          assets: Array.isArray(beat?.assets)
            ? beat.assets.map((asset) => ({
                id: String(asset?.id || ""),
                assetCode: String(asset?.assetCode || ""),
                days: Array.isArray(asset?.days) ? [...asset.days] : [],
              }))
            : [],
        };

        let canonicalKey = scopedDocKey && docAliasMap.has(scopedDocKey) ? docAliasMap.get(scopedDocKey) : "";

        if (!canonicalKey && scopedTitleKey) {
          const titleMatch = titleAliasMap.get(scopedTitleKey);
          if (titleMatch && titleMatch !== TITLE_AMBIGUOUS) {
            const currentRecord = canonicalRecords.get(titleMatch);
            // Prefer the beat doc URL when present, but allow a doc-backed record to upgrade a
            // previously title-only row so duplicate writer allocations do not inflate beat counts.
            if (!docKey || !currentRecord?.docKey) {
              canonicalKey = titleMatch;
            }
          }
        }

        if (!canonicalKey) {
          canonicalKey = scopedDocKey || scopedTitleKey;
        }

        if (shouldReplaceBeatRecord(canonicalRecords.get(canonicalKey), record)) {
          canonicalRecords.set(canonicalKey, record);
        }

        if (scopedDocKey) {
          docAliasMap.set(scopedDocKey, canonicalKey);
        }

        if (scopedTitleKey) {
          const existingTitleKey = titleAliasMap.get(scopedTitleKey);
          if (!existingTitleKey) {
            titleAliasMap.set(scopedTitleKey, canonicalKey);
          } else if (existingTitleKey !== canonicalKey && existingTitleKey !== TITLE_AMBIGUOUS) {
            titleAliasMap.set(scopedTitleKey, TITLE_AMBIGUOUS);
          }
        }
      }
    }
  }

  return Array.from(canonicalRecords.values());
}

function countStageCellsForRecord(record, targetStageId) {
  let count = 0;

  for (const asset of Array.isArray(record?.assets) ? record.assets : []) {
    for (const value of Array.isArray(asset?.days) ? asset.days : []) {
      if (normalizeStageId(value) === targetStageId) {
        count += 1;
      }
    }
  }

  return count;
}

export function recordHasStage(record, targetStageId) {
  return countStageCellsForRecord(record, targetStageId) > 0;
}

export function buildPlannerStageMetrics(records, options = {}) {
  const beatRecords = Array.isArray(records) ? records : [];
  const targetTatDays = Number(options?.targetTatDays || 1);
  const targetFloor = Number(options?.targetFloor || 22);

  const uniqueBeatCount = beatRecords.length;
  const plannedLiveCount = beatRecords.filter((record) => normalizeStageId(record?.latestStage) === "live_on_meta").length;
  const liveOnMetaBeatCount = beatRecords.filter((record) => recordHasStage(record, "live_on_meta")).length;
  const productionCellCount = beatRecords.reduce(
    (sum, record) => sum + countStageCellsForRecord(record, "production"),
    0
  );
  const productionBeatCount = beatRecords.filter((record) => countStageCellsForRecord(record, "production") > 0).length;
  const writingCellCount = beatRecords.reduce((sum, record) => sum + countStageCellsForRecord(record, "writing"), 0);
  const clReviewCellCount = beatRecords.reduce((sum, record) => sum + countStageCellsForRecord(record, "cl_review"), 0);
  const uniqueWriterCount = new Set(beatRecords.map((r) => String(r?.writerName || "").trim().toLowerCase()).filter(Boolean)).size;
  const scriptsPerWriter = uniqueWriterCount > 0 ? Number((productionBeatCount / uniqueWriterCount).toFixed(1)) : null;

  return {
    uniqueBeatCount,
    plannedLiveCount,
    liveOnMetaBeatCount,
    productionCellCount,
    productionBeatCount,
    writingCellCount,
    clReviewCellCount,
    uniqueWriterCount,
    scriptsPerWriter,
    expectedProductionTatDays:
      productionBeatCount > 0 ? Number((productionCellCount / productionBeatCount).toFixed(2)) : null,
    averageWritingDays: uniqueBeatCount > 0 ? Number((writingCellCount / uniqueBeatCount).toFixed(2)) : null,
    averageClReviewDays: uniqueBeatCount > 0 ? Number((clReviewCellCount / uniqueBeatCount).toFixed(2)) : null,
    targetTatDays,
    targetFloor,
  };
}

export function buildWritingMetricsFromPods(pods, options = {}) {
  const targetFloor = Number(options.targetFloor || 22);
  const perWriter = [];
  const perPod = [];
  let releasedCount = 0;
  let activeWriterCount = 0;

  for (const pod of Array.isArray(pods) ? pods : []) {
    let podReleasedCount = 0;

    for (const writer of Array.isArray(pod.writers) ? pod.writers : []) {
      activeWriterCount += 1;

      let writerReleasedCount = 0;
      for (const beat of Array.isArray(writer.beats) ? writer.beats : []) {
        for (const asset of Array.isArray(beat.assets) ? beat.assets : []) {
          if (getAssetLatestStage(asset) === "live_on_meta") {
            writerReleasedCount += 1;
            podReleasedCount += 1;
            releasedCount += 1;
          }
        }
      }

      perWriter.push({
        podId: pod.id,
        podName: pod.cl,
        writerId: writer.id,
        writerName: writer.name,
        releasedCount: writerReleasedCount,
      });
    }

    perPod.push({
      podId: pod.id,
      podName: pod.cl,
      color: pod.color,
      releasedCount: podReleasedCount,
    });
  }

  perWriter.sort((a, b) => b.releasedCount - a.releasedCount || a.writerName.localeCompare(b.writerName));
  perPod.sort((a, b) => b.releasedCount - a.releasedCount || a.podName.localeCompare(b.podName));

  return {
    targetFloor,
    expectedCapacity: activeWriterCount * 1.5,
    activeWriterCount,
    releasedCount,
    perWriter,
    perPod,
  };
}

export function getMondayForDate(input = new Date()) {
  const value = input instanceof Date ? input : new Date(input);
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  const day = date.getDay();
  const shift = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + shift);
  return date;
}

export function formatWeekKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseWeekKey(weekKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekKey || ""))) {
    return getMondayForDate();
  }

  const [year, month, day] = weekKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function getCurrentWeekKey() {
  return formatWeekKey(getMondayForDate());
}

export function getWeekDates(weekKey) {
  const monday = getMondayForDate(parseWeekKey(weekKey));
  return DAYS.map((_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
}

export function shiftWeekKey(weekKey, delta) {
  const monday = parseWeekKey(weekKey);
  monday.setDate(monday.getDate() + delta * 7);
  return formatWeekKey(getMondayForDate(monday));
}

export function formatShortDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function generateWeekKeysSince(sinceDate) {
  const keys = [];
  const currentKey = getCurrentWeekKey();
  let cursor = getMondayForDate(new Date(`${sinceDate}T12:00:00`));

  while (formatWeekKey(cursor) <= currentKey) {
    keys.push(formatWeekKey(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  return keys;
}

export function buildLifetimeBeatsPerPod(weekDataMap) {
  const podBeatSets = new Map();

  for (const [weekKey, weekData] of Object.entries(weekDataMap)) {
    if (!weekData) continue;
    const config = mergeWriterConfig(weekData.rosterSnapshot || createDefaultWriterConfig());
    const pods = buildPodsModel(config, weekData);

    for (const pod of pods) {
      const podName = String(pod?.cl || "").trim();
      if (!podName || !isVisiblePlannerPodLeadName(podName)) continue;

      if (!podBeatSets.has(podName)) {
        podBeatSets.set(podName, new Set());
      }

      const beatTitles = podBeatSets.get(podName);
      const records = buildPlannerBeatInventory([pod], { dedupeScope: "pod" });
      for (const record of records) {
        const titleKey = String(record?.beatTitle || "").trim().toLowerCase().replace(/\s+/g, " ");
        if (titleKey) {
          beatTitles.add(titleKey);
        }
      }
    }
  }

  const result = new Map();
  for (const [podName, beatSet] of podBeatSets) {
    result.set(podName, beatSet.size);
  }
  return result;
}
