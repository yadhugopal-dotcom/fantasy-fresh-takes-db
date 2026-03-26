"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DAYS,
  STAGES,
  STAGE_MAP,
  WRITER_ROLE_OPTIONS,
  buildPodsModel,
  createDefaultBeatRecord,
  createDefaultWeekData,
  getBeatId,
  createDefaultWriterConfig,
  formatShortDate,
  getCurrentWeekKey,
  getWeekDates,
  isVisiblePlannerPodLeadName,
  mergeWeekData,
  mergeWriterConfig,
  shiftWeekKey,
  summarizeAssetsFromPods,
} from "../lib/tracker-data.js";
import { copyNodeImageToClipboard } from "../lib/clipboard-share.js";

const SESSION_STORAGE_KEY = "fresh-take-gantt-edit";
const GRID_TEMPLATE_COLUMNS = "80px 130px 420px repeat(7, 1fr)";
const BODY_FONT = "var(--font-body)";
const DISPLAY_FONT = "var(--font-display)";
const MONO_FONT = "var(--font-display)";
const AUTOSAVE_DELAY_MS = 500;
const EMPTY_STAGE_SUMMARY = Object.fromEntries(STAGES.map((stage) => [stage.id, 0]));

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function makeFallbackAsset(assetId) {
  return {
    id: String(assetId || `asset-${Date.now()}`),
    assetCode: "",
    days: Array(DAYS.length).fill(null),
  };
}

function normalizeBeatForUi(beat, fallbackId = "beat", fallbackBeatNum = 1) {
  const safeBeat = asObject(beat);
  const assets = asArray(safeBeat.assets);

  return {
    id: typeof safeBeat.id === "string" && safeBeat.id.trim() ? safeBeat.id : fallbackId,
    beatNum: Number.isFinite(Number(safeBeat.beatNum)) ? Number(safeBeat.beatNum) : fallbackBeatNum,
    beatTitle: typeof safeBeat.beatTitle === "string" ? safeBeat.beatTitle : "",
    beatDocUrl: typeof safeBeat.beatDocUrl === "string" ? safeBeat.beatDocUrl : "",
    showName: typeof safeBeat.showName === "string" ? safeBeat.showName : "",
    sheetRowId: typeof safeBeat.sheetRowId === "string" ? safeBeat.sheetRowId : "",
    assets: assets.length
      ? assets.map((asset, index) => {
          const safeAsset = asObject(asset);
          return {
            id:
              typeof safeAsset.id === "string" && safeAsset.id.trim()
                ? safeAsset.id
                : `${fallbackId}-asset-${index + 1}`,
            assetCode: typeof safeAsset.assetCode === "string" ? safeAsset.assetCode : "",
            days: Array.from({ length: DAYS.length }, (_, dayIndex) => {
              const value = asArray(safeAsset.days)[dayIndex];
              return STAGE_MAP[value] ? value : null;
            }),
          };
        })
      : [makeFallbackAsset(`${fallbackId}-asset-1`)],
  };
}

function getBeatHref(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  const normalizedValue =
    /^https?:\/\//i.test(rawValue) ? rawValue : /^docs\.google\.com\//i.test(rawValue) ? `https://${rawValue}` : rawValue;

  try {
    const url = new URL(normalizedValue);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function StageBar({ stageId, isStart, isEnd }) {
  if (!stageId) {
    return null;
  }

  const stage = STAGE_MAP[stageId];
  if (!stage) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 3,
        bottom: 3,
        left: isStart ? 3 : 0,
        right: isEnd ? 3 : 0,
        background: stage.color,
        borderRadius: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity: 0.9,
      }}
    >
      {isStart ? (
        <span
          style={{
            fontSize: 8,
            fontWeight: 700,
            color: "#fff",
            whiteSpace: "nowrap",
            letterSpacing: "0.02em",
            padding: "0 3px",
            textShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        >
          {stage.label}
        </span>
      ) : null}
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) {
    return null;
  }

  const palette =
    toast.tone === "success"
      ? { background: "var(--green-bg)", border: "var(--forest)", color: "var(--forest)" }
      : { background: "var(--red-bg)", border: "var(--red)", color: "var(--red)" };

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 1200,
        minWidth: 260,
        maxWidth: 360,
        padding: "12px 14px",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        boxShadow: "0 18px 40px rgba(15,23,42,0.18)",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {toast.text}
    </div>
  );
}

function StatusBanner({ children }) {
  return (
    <div
      style={{
        marginBottom: 14,
        padding: "12px 14px",
        borderRadius: "var(--radius-md)",
        background: "var(--red-bg)",
        color: "var(--red)",
        border: "1px solid rgba(159, 46, 46, 0.2)",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function countWritersNotWritingToday(pods, todayIdx) {
  if (todayIdx < 0 || todayIdx >= 5) return 0;
  let count = 0;
  for (const pod of asArray(pods)) {
    for (const writer of asArray(pod?.writers)) {
      if (writer?.active === false) continue;
      const beats = asArray(writer?.beats);
      const isOoo = beats.some((beat) => {
        const safeBeat = normalizeBeatForUi(beat, "check");
        return safeBeat.assets.some((a) => asArray(a?.days)[todayIdx] === "writer_ooo");
      });
      if (isOoo) continue;
      const isWriting = beats.some((beat) => {
        const safeBeat = normalizeBeatForUi(beat, "check");
        return safeBeat.assets.some((a) => asArray(a?.days)[todayIdx] === "writing");
      });
      if (!isWriting) count += 1;
    }
  }
  return count;
}

function SummaryChips({ summary, notStarted, totalBeats, notWritingTodayCount }) {
  const safeSummary = summary && typeof summary === "object" ? summary : EMPTY_STAGE_SUMMARY;
  const beats = Number(totalBeats || 0);
  const production = Number(safeSummary.production || 0) + Number(safeSummary.live_on_meta || 0);
  const live = Number(safeSummary.live_on_meta || 0);
  const ooo = Number(safeSummary.writer_ooo || 0);
  const notWriting = Number(notWritingTodayCount || 0);

  const chips = [
    { value: beats, label: "Beats this week", color: "var(--navy)" },
    { value: production, label: "Expected in Production", color: STAGE_MAP.production?.text || "var(--forest)" },
    { value: live, label: "Expected Live", color: STAGE_MAP.live_on_meta?.text || "var(--forest)" },
    { value: ooo, label: "Writer OOO", color: STAGE_MAP.writer_ooo?.text || "var(--terracotta)" },
  ];

  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
      {chips.map((chip) => (
        <div
          key={chip.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            background: "var(--card)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
          }}
        >
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              fontFamily: MONO_FONT,
              color: chip.color,
            }}
          >
            {chip.value}
          </span>
          <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 500 }}>{chip.label}</span>
        </div>
      ))}
      {notWriting > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            background: "var(--red-bg)",
            borderRadius: "var(--radius-md)",
            border: "1px solid rgba(159, 46, 46, 0.25)",
          }}
        >
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              fontFamily: MONO_FONT,
              color: "var(--red)",
            }}
          >
            {notWriting}
          </span>
          <span style={{ fontSize: 10, color: "var(--red)", fontWeight: 700 }}>Not writing today</span>
        </div>
      ) : null}
    </div>
  );
}

function getLatestFilledDayIndex(days) {
  const safeDays = asArray(days);
  for (let index = safeDays.length - 1; index >= 0; index -= 1) {
    if (STAGE_MAP[safeDays[index]]) {
      return index;
    }
  }

  return -1;
}

function formatStageStreakLabel(stageId, count) {
  const stageLabel = String(STAGE_MAP?.[stageId]?.label || "Unknown stage").trim().toLowerCase();
  return `${count} days in ${stageLabel}`;
}

function getPreviousAssetDays(previousWeekData, beatId, assetId, assetIndex = 0) {
  const previousBeat = asObject(asObject(previousWeekData)?.beats)?.[beatId];
  if (!previousBeat) {
    return [];
  }

  const safeBeat = normalizeBeatForUi(previousBeat, beatId);
  const assets = asArray(safeBeat.assets);
  const matchedAsset =
    assets.find((asset) => String(asset?.id || "").trim() === String(assetId || "").trim()) || assets[assetIndex] || null;

  return Array.isArray(matchedAsset?.days) ? matchedAsset.days : [];
}

function countTrailingStageDays(days, stageId) {
  const safeDays = asArray(days);
  let count = 0;
  const startIndex = getLatestFilledDayIndex(safeDays);

  for (let index = startIndex; index >= 0; index -= 1) {
    if (safeDays[index] !== stageId) {
      break;
    }
    count += 1;
  }

  return count;
}

function getWriterActiveStageStreak(writer, { useTodayAnchor = false, todayIdx = -1, previousWeekData = null } = {}) {
  const safeWriter = asObject(writer);
  const beats = asArray(safeWriter.beats);
  let bestMatch = null;

  beats.forEach((beat, beatIndex) => {
    const safeBeat = normalizeBeatForUi(beat, `${safeWriter.id || "writer"}-beat-${beatIndex + 1}`, beatIndex + 1);

    safeBeat.assets.forEach((asset, assetIndex) => {
      const dayValues = Array.isArray(asset?.days) ? asset.days : Array(DAYS.length).fill(null);
      const anchorIndex = useTodayAnchor ? todayIdx : getLatestFilledDayIndex(dayValues);

      if (!Number.isInteger(anchorIndex) || anchorIndex < 0 || anchorIndex >= DAYS.length) {
        return;
      }

      const stageId = dayValues[anchorIndex];
      if (!STAGE_MAP[stageId]) {
        return;
      }

      let count = 1;
      let reachedWeekStart = true;
      for (let index = anchorIndex - 1; index >= 0; index -= 1) {
        if (dayValues[index] !== stageId) {
          reachedWeekStart = false;
          break;
        }
        count += 1;
      }

      if (reachedWeekStart && count === anchorIndex + 1) {
        const previousDays = getPreviousAssetDays(previousWeekData, safeBeat.id, asset?.id, assetIndex);
        count += countTrailingStageDays(previousDays, stageId);
      }

      if (!bestMatch || count > bestMatch.count) {
        bestMatch = {
          stageId,
          count,
          beatIndex,
          assetIndex,
          label: formatStageStreakLabel(stageId, count),
        };
      }
    });
  });

  return bestMatch && bestMatch.count > 2 ? bestMatch : null;
}

function buildRows(pods, options = {}) {
  const rows = [];

  asArray(pods).forEach((pod, podIndex) => {
    const safePod = {
      ...asObject(pod),
      id: typeof pod?.id === "string" ? pod.id : `pod-${podIndex + 1}`,
      cl: typeof pod?.cl === "string" ? pod.cl : `Pod ${podIndex + 1}`,
      color: typeof pod?.color === "string" && pod.color.trim() ? pod.color : "#475569",
      writers: asArray(pod?.writers),
    };

    const podRowCount = safePod.writers.reduce(
      (total, writer) =>
        total +
        asArray(writer?.beats).reduce((writerTotal, beat, beatIndex) => {
          const safeBeat = normalizeBeatForUi(beat, `${safePod.id}-${writer?.id || `writer-${beatIndex + 1}`}-beat-${beatIndex + 1}`);
          return writerTotal + safeBeat.assets.length;
        }, 0),
      0
    );
    let podRowIndex = 0;

    safePod.writers.forEach((writer, writerIndex) => {
      const safeWriter = {
        ...asObject(writer),
        id: typeof writer?.id === "string" ? writer.id : `${safePod.id}-writer-${writerIndex + 1}`,
        name: typeof writer?.name === "string" ? writer.name : "",
        role: typeof writer?.role === "string" && writer.role.trim() ? writer.role : "Writer",
        beats: asArray(writer?.beats),
      };
      const writerStageStreak = getWriterActiveStageStreak(safeWriter, options);
      const todayIdxForCheck = options.todayIdx != null ? options.todayIdx : -1;
      const writerHasWritingToday = todayIdxForCheck >= 0 && safeWriter.beats.some((beat) => {
        const safeBeat = normalizeBeatForUi(beat, "check");
        return safeBeat.assets.some((asset) => {
          const days = Array.isArray(asset?.days) ? asset.days : [];
          return days[todayIdxForCheck] === "writing";
        });
      });
      const writerIsOoo = todayIdxForCheck >= 0 && safeWriter.beats.some((beat) => {
        const safeBeat = normalizeBeatForUi(beat, "check");
        return safeBeat.assets.some((asset) => {
          const days = Array.isArray(asset?.days) ? asset.days : [];
          return days[todayIdxForCheck] === "writer_ooo";
        });
      });
      const writerRowCount = safeWriter.beats.reduce((total, beat, beatIndex) => {
        const safeBeat = normalizeBeatForUi(
          beat,
          `${safeWriter.id}-beat-${beatIndex + 1}`,
          beatIndex + 1
        );
        return total + safeBeat.assets.length;
      }, 0);
      let writerRowIndex = 0;

      safeWriter.beats.forEach((beat, beatIndex) => {
        const safeBeat = normalizeBeatForUi(beat, `${safeWriter.id}-beat-${beatIndex + 1}`, beatIndex + 1);
        const assetCount = safeBeat.assets.length;

        safeBeat.assets.forEach((asset, assetIndex) => {
          rows.push({
            key: `${safePod.id}-${safeWriter.id}-${safeBeat.id}-${asset.id}`,
            pod: safePod,
            writer: {
              ...safeWriter,
              stageStreak: writerStageStreak,
              hasWritingToday: writerHasWritingToday,
              isOoo: writerIsOoo,
            },
            beat: safeBeat,
            asset,
            assetIndex,
            assetCount,
            beatIndex,
            writerBeatCount: safeWriter.beats.length,
            isFirstPodRow: podRowIndex === 0,
            isLastPodRow: podRowIndex === podRowCount - 1,
            isFirstWriterRow: writerRowIndex === 0,
            isLastWriterRow: writerRowIndex === writerRowCount - 1,
            isFirstAssetRow: assetIndex === 0,
            isLastAssetRow: assetIndex === assetCount - 1,
          });

          podRowIndex += 1;
          writerRowIndex += 1;
        });
      });
    });
  });

  return rows;
}

function BeatDocPicker({
  beat,
  editable,
  options,
  loading,
  message,
  onOpen,
  onSelect,
  onClear,
}) {
  const safeBeat = normalizeBeatForUi(beat);
  const safeOptions = asArray(options);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [manualBeatTitle, setManualBeatTitle] = useState("");
  const [manualShowName, setManualShowName] = useState("");
  const containerRef = useRef(null);
  const trimmedSearch = search.trim().toLowerCase();
  const hasBeatSelection = Boolean(safeBeat.beatTitle || safeBeat.beatDocUrl || safeBeat.sheetRowId);
  const beatHref = getBeatHref(safeBeat.beatDocUrl);
  const canLinkBeat = Boolean(beatHref);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
        setManualMode(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  const filteredOptions = useMemo(() => {
    if (!trimmedSearch) {
      return safeOptions;
    }

    return safeOptions.filter((option) =>
      `${option?.beatTitle || ""} ${option?.showName || ""} ${option?.beatName || ""} ${option?.podName || ""} ${option?.status || ""}`
        .toLowerCase()
        .includes(trimmedSearch)
    );
  }, [safeOptions, trimmedSearch]);

  if (!editable) {
    if (!safeBeat.beatTitle) {
      return <div style={textStyle}>{"\u00A0"}</div>;
    }

    const content = (
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            ...textStyle,
            fontWeight: 600,
            color: canLinkBeat ? "var(--accent)" : textStyle.color,
            textDecoration: canLinkBeat ? "underline" : "none",
            textUnderlineOffset: canLinkBeat ? "2px" : undefined,
            textDecorationThickness: canLinkBeat ? "1px" : undefined,
          }}
        >
          {safeBeat.beatTitle}
        </div>
        <div style={{ ...subtleTextStyle, marginTop: 1 }}>{safeBeat.showName || "\u00A0"}</div>
      </div>
    );

    if (!canLinkBeat) {
      return content;
    }

    return (
      <a
        href={beatHref}
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: "none", display: "block" }}
        title={safeBeat.beatTitle || "Open selected beat doc"}
      >
        {content}
      </a>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
        <div style={beatFieldButtonStyle}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {hasBeatSelection && canLinkBeat ? (
              <a
                href={beatHref}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  ...textStyle,
                  display: "block",
                  fontWeight: 600,
                  color: "var(--accent)",
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                  textDecorationThickness: "1px",
                }}
                title={safeBeat.beatTitle || "Open selected beat doc"}
              >
                {safeBeat.beatTitle}
              </a>
            ) : (
              <div
                style={{
                  ...textStyle,
                  fontWeight: hasBeatSelection ? 600 : 500,
                  color: hasBeatSelection ? "var(--ink)" : "var(--muted)",
                }}
              >
                {hasBeatSelection
                  ? safeBeat.beatTitle
                  : message && !safeOptions.length
                    ? message
                    : `Beat ${safeBeat.beatNum}...`}
              </div>
            )}
            <div style={{ ...subtleTextStyle, marginTop: 1 }}>
              {safeBeat.showName || (hasBeatSelection ? "\u00A0" : "Search by beat title")}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const nextOpen = !open;
              setOpen(nextOpen);
              if (nextOpen) {
                onOpen();
              }
            }}
            style={{ ...clearFieldBtnStyle, width: 22, height: 22, borderRadius: "var(--radius-sm)" }}
            title={hasBeatSelection ? "Change beat selection" : "Select beat"}
          >
            ▾
          </button>
        </div>

        {hasBeatSelection ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClear();
            }}
            style={clearFieldBtnStyle}
            title="Clear beat selection"
          >
            x
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: -110,
            zIndex: 200,
            width: 320,
            maxHeight: 300,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 18px 44px rgba(15,23,42,0.16)",
          }}
        >
          {manualMode ? (
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                onClick={() => setManualMode(false)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontSize: 11,
                  color: "var(--muted)",
                  textAlign: "left",
                  fontFamily: BODY_FONT,
                }}
              >
                &larr; Back
              </button>
              <input
                autoFocus
                type="text"
                value={manualBeatTitle}
                onChange={(event) => setManualBeatTitle(event.target.value)}
                placeholder="Beat title"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "8px 10px",
                  fontSize: 11,
                  fontFamily: BODY_FONT,
                  color: "var(--ink)",
                  outline: "none",
                }}
              />
              <input
                type="text"
                value={manualShowName}
                onChange={(event) => setManualShowName(event.target.value)}
                placeholder="Show name"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "8px 10px",
                  fontSize: 11,
                  fontFamily: BODY_FONT,
                  color: "var(--ink)",
                  outline: "none",
                }}
              />
              <button
                type="button"
                disabled={!manualBeatTitle.trim()}
                onClick={() => {
                  onSelect({
                    beatTitle: manualBeatTitle.trim(),
                    showName: manualShowName.trim(),
                    beatDocUrl: "",
                    sheetRowId: "",
                  });
                  setOpen(false);
                  setManualMode(false);
                  setManualBeatTitle("");
                  setManualShowName("");
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "none",
                  background: manualBeatTitle.trim() ? "var(--ink)" : "var(--border)",
                  color: manualBeatTitle.trim() ? "var(--card)" : "var(--muted)",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: BODY_FONT,
                  cursor: manualBeatTitle.trim() ? "pointer" : "default",
                }}
              >
                Save
              </button>
            </div>
          ) : (
            <>
              {!message ? (
                <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--card-alt)" }}>
                  <input
                    autoFocus
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search GTG beats..."
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "8px 10px",
                      fontSize: 11,
                      fontFamily: BODY_FONT,
                      color: "var(--ink)",
                      outline: "none",
                    }}
                  />
                </div>
              ) : null}

              <div style={{ overflowY: "auto", flex: 1 }}>
                {loading ? (
                  <div style={pickerMessageStyle}>Loading beat docs from Google Sheets...</div>
                ) : null}

                {!loading && message ? <div style={pickerMessageStyle}>{message}</div> : null}

                {!loading && !message && filteredOptions.length === 0 ? (
                  <div style={pickerMessageStyle}>No matching GTG beats found.</div>
                ) : null}

                {!loading && !message
                  ? filteredOptions.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => {
                          onSelect(option);
                          setOpen(false);
                          setSearch("");
                        }}
                        style={pickerOptionStyle}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)" }}>
                          {option.beatTitle || option.beatName || "Untitled Beat"}
                        </div>
                        <div
                          style={{
                            marginTop: 3,
                            fontSize: 10,
                            color: "var(--muted)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {option.showName || "Untitled Show"}
                        </div>
                      </button>
                    ))
                  : null}
              </div>

              <div style={{ padding: "6px 10px", borderTop: "1px solid var(--card-alt)" }}>
                <button
                  type="button"
                  onClick={() => {
                    setManualMode(true);
                    setSearch("");
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px dashed var(--border)",
                    background: "var(--card-alt)",
                    color: "var(--ink-secondary)",
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: BODY_FONT,
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                >
                  Other (manual entry)
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TrackerTable({
  pods,
  weekDates,
  todayIdx,
  previousWeekData = null,
  useTodayStreakAnchor = false,
  editable,
  rosterEditable,
  beatDocs,
  beatDocsLoading,
  beatDocsMessage,
  onBeatDocsOpen,
  onWriterNameChange,
  onAddBeat,
  onRemoveBeat,
  onBeatDocSelect,
  onBeatDocClear,
  onPaintStart,
  onPaintEnter,
}) {
  const safeWeekDates = asArray(weekDates).slice(0, DAYS.length);
  const safeBeatDocs = asArray(beatDocs);
  const rows = useMemo(
    () =>
      buildRows(pods, {
        useTodayAnchor: useTodayStreakAnchor,
        todayIdx,
        previousWeekData,
      }),
    [pods, previousWeekData, todayIdx, useTodayStreakAnchor]
  );

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 0,
        boxShadow: "none",
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
          minWidth: 940,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {["Pod", "Writer", "Beats"].map((label) => (
          <div key={label} style={hdrCell}>
            {label}
          </div>
        ))}
        {safeWeekDates.map((date, index) => {
          const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
          return (
          <div
            key={safeDate ? safeDate.toISOString() : `day-${index}`}
            style={{
              ...hdrCell,
              textAlign: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 1,
              background: index === todayIdx ? "var(--accent)" : "var(--card-alt)",
              color: index === todayIdx ? "#fff" : "var(--muted)",
              borderBottom: index === todayIdx ? "2px solid var(--accent)" : "1px solid var(--border)",
            }}
          >
            <span>{DAYS[index]}</span>
            <span style={{ fontFamily: MONO_FONT, fontSize: 9, opacity: 0.8 }}>
              {safeDate ? formatShortDate(safeDate) : "-"}
            </span>
          </div>
          );
        })}
      </div>

      {rows.map((row) => {
        const rowBorder = !row.isLastAssetRow
          ? "1px dashed var(--border)"
          : !row.isLastWriterRow
            ? "1px solid var(--border)"
              : !row.isLastPodRow
              ? "1.5px solid var(--border)"
              : "2px solid var(--border)";

        return (
          <div
            key={row.key}
            style={{
              display: "grid",
              gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
              minWidth: 940,
              minHeight: 34,
              background: row.assetIndex % 2 === 0 ? "var(--card)" : "var(--surface)",
            }}
          >
            <div
              style={{
                background: row.pod.color,
                color: "#fff",
                fontWeight: 700,
                fontSize: row.isFirstPodRow ? 13 : 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: row.isFirstPodRow ? "6px 4px" : 0,
                borderRight: "1px solid rgba(255,255,255,0.15)",
                borderBottom: row.isLastPodRow ? rowBorder : "none",
              }}
            >
              {row.isFirstPodRow ? row.pod.cl : ""}
            </div>

            <div
              style={{
                padding: "3px 6px",
                background: "var(--surface)",
                borderRight: "1px solid var(--border)",
                display: "flex",
                alignItems: row.isFirstWriterRow ? "flex-start" : "center",
                borderBottom: rowBorder,
              }}
            >
              {row.isFirstWriterRow ? (
                <div style={{ display: "grid", gap: 2, width: "100%" }}>
                  {rosterEditable ? (
                    <input
                      type="text"
                      value={row.writer.name}
                      onChange={(event) =>
                        onWriterNameChange(row.pod.id, row.writer.id, event.target.value)
                      }
                      style={{ ...inputStyle, fontWeight: 600, fontSize: 11 }}
                    />
                  ) : (
                    <div style={{
                      ...textStyle,
                      fontWeight: 600,
                      color: (!row.writer.hasWritingToday && !row.writer.isOoo && todayIdx >= 0 && todayIdx < 5)
                        ? "var(--amber)" : "var(--ink)",
                    }}>{row.writer.name || "\u00A0"}</div>
                  )}
                  <div style={{ ...subtleTextStyle, fontSize: 10 }}>{row.writer.role || "Writer"}</div>
                  {!row.writer.hasWritingToday && !row.writer.isOoo && todayIdx >= 0 && todayIdx < 5 ? (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        width: "fit-content",
                        maxWidth: "100%",
                        marginTop: 2,
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: "var(--amber-bg)",
                        border: "1px solid rgba(159, 107, 21, 0.18)",
                        color: "var(--amber)",
                        fontSize: 9,
                        fontWeight: 700,
                        lineHeight: 1.2,
                      }}
                    >
                      Not writing today
                    </div>
                  ) : null}
                  {row.writer.stageStreak ? (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        width: "fit-content",
                        maxWidth: "100%",
                        marginTop: 2,
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: "var(--red-bg)",
                        border: "1px solid rgba(159, 46, 46, 0.2)",
                        color: "var(--red)",
                        fontSize: 10,
                        fontWeight: 700,
                        lineHeight: 1.2,
                      }}
                    >
                      {row.writer.stageStreak.label}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div
              style={{
                padding: "3px 6px",
                borderRight: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                borderBottom: rowBorder,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
                <BeatDocPicker
                  beat={row.beat}
                  editable={editable}
                  options={safeBeatDocs}
                  loading={beatDocsLoading}
                  message={beatDocsMessage}
                  onOpen={onBeatDocsOpen}
                  onSelect={(option) => onBeatDocSelect(row.beat.id, option)}
                  onClear={() => onBeatDocClear(row.beat.id)}
                />

                {editable && row.isLastWriterRow ? (
                  <button
                    onClick={() => onAddBeat(row.writer.id)}
                    style={tinyBtn}
                    title="Add another beat for this writer"
                  >
                    +
                  </button>
                ) : null}

                {editable && row.isFirstAssetRow && row.writerBeatCount > 1 ? (
                  <button
                    onClick={() => onRemoveBeat(row.beat.id)}
                    style={{ ...tinyBtn, color: "var(--red)", borderColor: "var(--red-bg)" }}
                    title="Remove this beat"
                  >
                    x
                  </button>
                ) : null}
              </div>
            </div>

            {DAYS.map((_, dayIndex) => {
              const dayValues = Array.isArray(row.asset?.days) ? row.asset.days : Array(DAYS.length).fill(null);
              const stageId = dayValues[dayIndex];
              const previousStage = dayIndex > 0 ? dayValues[dayIndex - 1] : null;
              const nextStage = dayIndex < DAYS.length - 1 ? dayValues[dayIndex + 1] : null;
              const isToday = dayIndex === todayIdx;

              return (
                <div
                  key={`${row.asset.id}-${dayIndex}`}
                  onPointerDown={
                    editable
                      ? (event) => {
                          event.preventDefault();
                          onPaintStart(row.asset.id, row.beat.id, row.asset.id, dayIndex);
                        }
                      : undefined
                  }
                  onPointerEnter={
                    editable
                      ? () => onPaintEnter(row.asset.id, row.beat.id, row.asset.id, dayIndex)
                      : undefined
                  }
                  style={{
                    position: "relative",
                    minHeight: 32,
                    cursor: editable ? "pointer" : "default",
                    borderRight: dayIndex < DAYS.length - 1 ? "1px solid var(--border)" : "none",
                    borderBottom: rowBorder,
                    background: isToday ? "rgba(159, 78, 46, 0.06)" : "transparent",
                    borderLeft: isToday ? "2px solid rgba(159, 78, 46, 0.25)" : "none",
                  }}
                >
                  <StageBar
                    stageId={stageId}
                    isStart={Boolean(stageId && stageId !== previousStage)}
                    isEnd={Boolean(stageId && stageId !== nextStage)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function RosterManager({
  writerConfig,
  editable,
  isFutureWeek,
  onWriterNameChange,
  onWriterRoleChange,
  onWriterMovePod,
  onDeleteWriter,
  onAddWriter,
  onAddPod,
  onDeletePod,
}) {
  const [dragWriter, setDragWriter] = useState(null);
  const [dropPodId, setDropPodId] = useState("");
  const pods = useMemo(
    () =>
      [...(Array.isArray(writerConfig?.pods) ? writerConfig.pods : [])]
        .filter((pod) => pod?.active !== false && isVisiblePlannerPodLeadName(pod?.cl))
        .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0)),
    [writerConfig]
  );

  if (!editable) {
    return null;
  }

  return (
    <div
      style={{
        background: "var(--card)",
        borderRadius: 14,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Roster Manager
        </div>
        <div style={{ fontSize: 13, color: "var(--ink)", marginTop: 4 }}>
          Add writers, move them between pods, and manage your roster.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        {pods.map((pod) => {
          const activeWriters = (Array.isArray(pod.writers) ? pod.writers : []).filter((writer) => writer.active !== false);

          return (
            <div
              key={pod.id}
              style={{
                border: dropPodId === pod.id ? `2px dashed ${pod.color}` : "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                background: "var(--card-alt)",
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDropPodId(pod.id);
              }}
              onDragLeave={() => {
                setDropPodId((current) => (current === pod.id ? "" : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragWriter?.podId && dragWriter?.writerId) {
                  onWriterMovePod(dragWriter.podId, dragWriter.writerId, pod.id);
                }
                setDragWriter(null);
                setDropPodId("");
              }}
            >
              <div
                style={{
                  background: pod.color,
                  color: "#fff",
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{pod.cl}</div>
                  <div style={{ fontSize: 10, opacity: 0.8 }}>Active writers: {activeWriters.length}</div>
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    onClick={() => onAddWriter(pod.id)}
                    style={{
                      ...tinyBtn,
                      width: "auto",
                      height: "auto",
                      padding: "5px 8px",
                      borderRadius: 999,
                    }}
                  >
                    + Add Writer
                  </button>
                  <button
                    onClick={() => isFutureWeek && onDeletePod(pod.id)}
                    title={isFutureWeek ? `Delete POD "${pod.cl}"` : "Can only delete PODs on future weeks"}
                    style={{
                      ...tinyBtn,
                      width: "auto",
                      height: "auto",
                      padding: "5px 8px",
                      borderRadius: 999,
                      opacity: isFutureWeek ? 1 : 0.4,
                      cursor: isFutureWeek ? "pointer" : "not-allowed",
                      background: "rgba(255,255,255,0.2)",
                      color: "#fff",
                      borderColor: "rgba(255,255,255,0.3)",
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div style={{ padding: 10, display: "grid", gap: 8 }}>
                {activeWriters.length > 0 ? (
                  activeWriters.map((writer) => (
                    <div
                      key={writer.id}
                      draggable
                      onDragStart={() => setDragWriter({ podId: pod.id, writerId: writer.id })}
                      onDragEnd={() => {
                        setDragWriter(null);
                        setDropPodId("");
                      }}
                      style={{
                        display: "grid",
                        gap: 6,
                        gridTemplateColumns: "minmax(0, 1fr) 150px auto",
                        alignItems: "center",
                        cursor: "grab",
                      }}
                    >
                      <input
                        type="text"
                        value={writer.name}
                        onChange={(event) => onWriterNameChange(pod.id, writer.id, event.target.value)}
                        style={{
                          ...inputStyle,
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          padding: "8px 10px",
                        }}
                      />
                      <select
                        value={writer.role || "Writer"}
                        onChange={(event) => onWriterRoleChange(pod.id, writer.id, event.target.value)}
                        style={{
                          ...inputStyle,
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          padding: "8px 10px",
                        }}
                      >
                        {WRITER_ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => isFutureWeek && onDeleteWriter(pod.id, writer.id)}
                        title={isFutureWeek ? "Delete writer" : "Can only delete writers on future weeks"}
                        style={{
                          ...tinyBtn,
                          width: "auto",
                          height: "auto",
                          padding: "8px 10px",
                          color: isFutureWeek ? "var(--red)" : "var(--muted)",
                          borderColor: isFutureWeek ? "var(--red-bg)" : "var(--border)",
                          background: isFutureWeek ? "var(--red-bg)" : "var(--card-alt)",
                          cursor: isFutureWeek ? "pointer" : "not-allowed",
                          opacity: isFutureWeek ? 1 : 0.5,
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {dragWriter ? "Drop a writer here to move them into this POD." : "No active writers in this pod yet."}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isFutureWeek && (
          <div
            onClick={onAddPod}
            style={{
              border: "2px dashed var(--border)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
              background: "var(--card-alt)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 80,
              cursor: "pointer",
              color: "var(--muted)",
              fontSize: 13,
              fontWeight: 600,
              gap: 6,
            }}
          >
            + Add POD
          </div>
        )}
      </div>
    </div>
  );
}

function SnapshotBoard({
  weekLabel,
  summary,
  notStarted,
  totalBeats,
  pods,
  weekDates,
  todayIdx,
  previousWeekData,
}) {
  return (
    <div
      style={{
        width: 1500,
        background: "var(--bg)",
        padding: "18px 24px 24px",
        fontFamily: BODY_FONT,
      }}
    >
      <div
        style={{
          background: "var(--card)",
          borderBottom: "1px solid var(--border)",
          padding: "18px 28px",
          color: "var(--ink)",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              fontFamily: MONO_FONT,
              minWidth: 150,
              textAlign: "center",
              color: "var(--muted)",
            }}
          >
            {weekLabel}
          </div>
        </div>
      </div>

      <SummaryChips summary={summary} notStarted={notStarted} totalBeats={totalBeats} />

      <TrackerTable
        pods={pods}
        weekDates={weekDates}
        todayIdx={todayIdx}
        previousWeekData={previousWeekData}
        useTodayStreakAnchor={todayIdx >= 0}
        editable={false}
        rosterEditable={false}
        beatDocs={[]}
        beatDocsLoading={false}
        beatDocsMessage=""
        onBeatDocsOpen={() => {}}
        onWriterNameChange={() => {}}
        onAddBeat={() => {}}
        onRemoveBeat={() => {}}
        onBeatDocSelect={() => {}}
        onBeatDocClear={() => {}}
        onPaintStart={() => {}}
        onPaintEnter={() => {}}
      />
    </div>
  );
}

function statusText(saveState) {
  if (saveState === "saving") {
    return "Saving...";
  }

  if (saveState === "saved") {
    return "Saved";
  }

  if (saveState === "error") {
    return "Save failed";
  }

  return "All changes sync automatically";
}

function makeClientAsset(beatId) {
  const randomId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: `${beatId}-${randomId}`,
    assetCode: "",
    days: Array(DAYS.length).fill(null),
  };
}

async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {};
  }

  return response.json();
}

function formatCommitTimestamp(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export default function GanttTracker({ onPlannerSnapshotChange = null }) {
  const [weekKey, setWeekKey] = useState(getCurrentWeekKey);
  const [writerConfig, setWriterConfig] = useState(() => createDefaultWriterConfig());
  const [weekData, setWeekData] = useState(() =>
    createDefaultWeekData(createDefaultWriterConfig(), getCurrentWeekKey())
  );
  const [previousWeekData, setPreviousWeekData] = useState(() =>
    createDefaultWeekData(createDefaultWriterConfig(), shiftWeekKey(getCurrentWeekKey(), -1))
  );
  const [activeBrush, setActiveBrush] = useState("beats_ideation");
  const [eraseMode, setEraseMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [editUnlocked, setEditUnlocked] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(true);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [isCopyingShare, setIsCopyingShare] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [beatDocs, setBeatDocs] = useState([]);
  const [beatDocsLoading, setBeatDocsLoading] = useState(false);
  const [beatDocsMessage, setBeatDocsMessage] = useState("");
  const [committedSnapshotMeta, setCommittedSnapshotMeta] = useState(null);
  const [committedSnapshotData, setCommittedSnapshotData] = useState(null);
  const [toast, setToast] = useState(null);

  const dragRef = useRef({ active: false, assetId: null });
  const captureRef = useRef(null);
  const weekSkipSaveRef = useRef(true);
  const configSkipSaveRef = useRef(true);
  const weekDirtyRef = useRef(false);
  const configDirtyRef = useRef(false);
  const weekTimerRef = useRef(null);
  const configTimerRef = useRef(null);
  const latestWriterConfigRef = useRef(writerConfig);
  const latestWeekDataRef = useRef(weekData);
  const latestWeekKeyRef = useRef(weekKey);
  const latestEditUnlockedRef = useRef(editUnlocked);
  const isMountedRef = useRef(true);

  latestWriterConfigRef.current = writerConfig;
  latestWeekDataRef.current = weekData;
  latestWeekKeyRef.current = weekKey;
  latestEditUnlockedRef.current = editUnlocked;

  const weekDates = useMemo(() => getWeekDates(weekKey), [weekKey]);
  const todayStr = new Date().toDateString();
  const todayIdx = weekDates.findIndex((date) => date.toDateString() === todayStr);
  const weekLabel =
    weekDates[0] instanceof Date && weekDates[6] instanceof Date
      ? `${formatShortDate(weekDates[0])} - ${formatShortDate(weekDates[6])}`
      : String(weekKey || "");
  const currentWeekKey = getCurrentWeekKey();
  const nextWeekKey = shiftWeekKey(currentWeekKey, 1);
  const isHistoricalWeek = weekKey < currentWeekKey;
  const isNextWeek = weekKey === nextWeekKey;
  const canEditRoster = editUnlocked && !isHistoricalWeek;
  const {
    pods,
    committedPods,
    summary,
    notStarted,
    totalBeats,
    plannerRenderError,
  } = useMemo(() => {
    try {
      const nextDisplayConfig = isHistoricalWeek
        ? mergeWriterConfig(weekData?.rosterSnapshot || writerConfig)
        : mergeWriterConfig(writerConfig);
      const nextWeekData = mergeWeekData(nextDisplayConfig, weekData, weekKey);
      const nextPods = buildPodsModel(nextDisplayConfig, nextWeekData).filter((pod) =>
        isVisiblePlannerPodLeadName(pod?.cl)
      );
      let nextCommittedPods = [];
      if (committedSnapshotData?.weekData && committedSnapshotData?.rosterSnapshot) {
        const committedConfig = mergeWriterConfig(committedSnapshotData.rosterSnapshot);
        const committedWeekData = mergeWeekData(committedConfig, committedSnapshotData.weekData, weekKey);
        nextCommittedPods = buildPodsModel(committedConfig, committedWeekData).filter((pod) =>
          isVisiblePlannerPodLeadName(pod?.cl)
        );
      }
      const nextSummary = summarizeAssetsFromPods(nextPods);
      const nextTotalBeats = nextPods.reduce(
        (sum, pod) =>
          sum +
          pod.writers.reduce(
            (wSum, writer) =>
              wSum +
              writer.beats.filter(
                (beat) => String(beat.beatTitle || "").trim() || String(beat.beatDocUrl || "").trim()
              ).length,
            0
          ),
        0
      );

      return {
        displayConfig: nextDisplayConfig,
        safeWeekData: nextWeekData,
        pods: nextPods,
        committedPods: nextCommittedPods,
        summary: nextSummary.summary,
        notStarted: nextSummary.notStarted,
        totalBeats: nextTotalBeats,
        plannerRenderError: "",
      };
    } catch (error) {
      const fallbackConfig = createDefaultWriterConfig();
      const fallbackWeekData = createDefaultWeekData(fallbackConfig, weekKey);
      const fallbackPods = buildPodsModel(fallbackConfig, fallbackWeekData).filter((pod) =>
        isVisiblePlannerPodLeadName(pod?.cl)
      );
      const fallbackSummary = summarizeAssetsFromPods(fallbackPods);

      return {
        displayConfig: fallbackConfig,
        safeWeekData: fallbackWeekData,
        pods: fallbackPods,
        committedPods: [],
        summary: fallbackSummary.summary,
        notStarted: fallbackSummary.notStarted,
        totalBeats: 0,
        plannerRenderError: error?.message || "Unable to render this planner week safely.",
      };
    }
  }, [committedSnapshotData, isHistoricalWeek, weekData, weekKey, writerConfig]);
  const plannerInteractionDisabled = Boolean(plannerRenderError);

  useEffect(() => {
    if (typeof onPlannerSnapshotChange !== "function") {
      return undefined;
    }

    onPlannerSnapshotChange({
      weekKey,
      weekLabel,
      isNextWeek,
      isHistoricalWeek,
      isLoading,
      plannerRenderError,
      pods,
      committedPods,
      committedSnapshotMeta,
    });
  }, [
    committedPods,
    committedSnapshotMeta,
    isHistoricalWeek,
    isLoading,
    isNextWeek,
    onPlannerSnapshotChange,
    plannerRenderError,
    pods,
    weekKey,
    weekLabel,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const payload = await readJson(response);

        if (cancelled || !response.ok) {
          return;
        }

        const unlocked = Boolean(payload.unlocked);
        setEditUnlocked(unlocked);
        setAuthConfigured(payload.configured !== false);

        if (typeof window !== "undefined") {
          if (unlocked) {
            window.sessionStorage.setItem(SESSION_STORAGE_KEY, "1");
          } else {
            window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
          }
        }
      } catch {
        if (!cancelled) {
          setAuthConfigured(false);
        }
      } finally {
        if (!cancelled) {
          setSessionChecked(true);
        }
      }
    }

    loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBeatDocs() {
      try {
        setBeatDocsLoading(true);
        setBeatDocsMessage("");

        const response = await fetch("/api/beat-docs", { cache: "no-store" });
        const payload = await readJson(response);

        if (cancelled) {
          return;
        }

        if (payload.connected === false) {
          setBeatDocs([]);
          setBeatDocsMessage(payload.message || "Beat docs not connected yet");
          return;
        }

        if (!response.ok) {
          throw new Error(payload.message || "Unable to load beat docs.");
        }

        setBeatDocsMessage("");
        setBeatDocs(Array.isArray(payload.items) ? payload.items : []);
      } catch (error) {
        if (!cancelled) {
          setBeatDocs([]);
          setBeatDocsMessage(error.message || "Unable to load beat docs right now.");
        }
      } finally {
        if (!cancelled) {
          setBeatDocsLoading(false);
        }
      }
    }

    loadBeatDocs();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadWeek() {
      setIsLoading(true);
      setLoadError("");
      setSaveState("idle");
      setCommittedSnapshotMeta(null);
      setCommittedSnapshotData(null);

      try {
        const previousWeekKey = shiftWeekKey(weekKey, -1);
        const [configResponse, weekResponse, previousWeekResponse] = await Promise.all([
          fetch("/api/tracker-config", { cache: "no-store" }),
          fetch(`/api/tracker-week?week=${encodeURIComponent(weekKey)}`, { cache: "no-store" }),
          fetch(`/api/tracker-week?week=${encodeURIComponent(previousWeekKey)}`, { cache: "no-store" }),
        ]);

        const [configPayload, weekPayload, previousWeekPayload] = await Promise.all([
          readJson(configResponse),
          readJson(weekResponse),
          readJson(previousWeekResponse),
        ]);

        if (!configResponse.ok) {
          throw new Error(configPayload.error || "Unable to load writer config.");
        }

        if (!weekResponse.ok) {
          throw new Error(weekPayload.error || "Unable to load this week.");
        }

        if (!previousWeekResponse.ok) {
          throw new Error(previousWeekPayload.error || "Unable to load the previous week.");
        }

        const nextWriterConfig = mergeWriterConfig(configPayload.config || configPayload);
        const nextWeekData = mergeWeekData(nextWriterConfig, weekPayload.weekData || weekPayload, weekKey);
        const nextPreviousWeekData = mergeWeekData(
          nextWriterConfig,
          previousWeekPayload.weekData || previousWeekPayload,
          previousWeekKey
        );

        if (!cancelled) {
          setWriterConfig(nextWriterConfig);
          setWeekData(nextWeekData);
          setPreviousWeekData(nextPreviousWeekData);
          setCommittedSnapshotMeta(weekPayload.committedSnapshot || null);
          setCommittedSnapshotData(weekPayload.committedSnapshotData || null);
          weekSkipSaveRef.current = true;
          configSkipSaveRef.current = true;
          weekDirtyRef.current = false;
          configDirtyRef.current = false;
        }
      } catch (error) {
        if (!cancelled) {
          const nextWriterConfig = createDefaultWriterConfig();
          setWriterConfig(nextWriterConfig);
          setWeekData(createDefaultWeekData(nextWriterConfig, weekKey));
          setPreviousWeekData(createDefaultWeekData(nextWriterConfig, shiftWeekKey(weekKey, -1)));
          setCommittedSnapshotMeta(null);
          setCommittedSnapshotData(null);
          weekSkipSaveRef.current = true;
          configSkipSaveRef.current = true;
          weekDirtyRef.current = false;
          configDirtyRef.current = false;
          setLoadError(error.message || "Unable to load this week.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadWeek();

    return () => {
      cancelled = true;
    };
  }, [weekKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !sessionChecked) {
      return;
    }

    if (editUnlocked) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, "1");
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [editUnlocked, sessionChecked]);

  useEffect(() => {
    if (isLoading || !editUnlocked) {
      return undefined;
    }

    if (weekSkipSaveRef.current) {
      weekSkipSaveRef.current = false;
      return undefined;
    }

    weekDirtyRef.current = true;

    if (weekTimerRef.current) {
      window.clearTimeout(weekTimerRef.current);
    }

    weekTimerRef.current = window.setTimeout(() => {
      weekTimerRef.current = null;
      void persistWeek(latestWeekKeyRef.current, latestWeekDataRef.current);
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (weekTimerRef.current) {
        window.clearTimeout(weekTimerRef.current);
      }
    };
  }, [weekData, editUnlocked, isLoading]);

  useEffect(() => {
    if (isLoading || !editUnlocked) {
      return undefined;
    }

    if (configSkipSaveRef.current) {
      configSkipSaveRef.current = false;
      return undefined;
    }

    configDirtyRef.current = true;

    if (configTimerRef.current) {
      window.clearTimeout(configTimerRef.current);
    }

    configTimerRef.current = window.setTimeout(() => {
      configTimerRef.current = null;
      void persistWriterConfig(latestWriterConfigRef.current);
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (configTimerRef.current) {
        window.clearTimeout(configTimerRef.current);
      }
    };
  }, [writerConfig, editUnlocked, isLoading]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 4200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  useEffect(() => {
    return () => {
      void flushPendingSaves({ silent: true });
      isMountedRef.current = false;
      if (weekTimerRef.current) {
        window.clearTimeout(weekTimerRef.current);
      }
      if (configTimerRef.current) {
        window.clearTimeout(configTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    function handlePageHide() {
      void flushPendingSaves({ silent: true, keepalive: true });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        void flushPendingSaves({ silent: true, keepalive: true });
      }
    }

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  async function loadBeatDocsOnDemand() {
    if (beatDocsLoading) {
      return;
    }

    try {
      setBeatDocsLoading(true);
      setBeatDocsMessage("");

      const response = await fetch("/api/beat-docs", { cache: "no-store" });
      const payload = await readJson(response);

      if (payload.connected === false) {
        setBeatDocs([]);
        setBeatDocsMessage(payload.message || "Beat docs not connected yet");
        return;
      }

      if (!response.ok) {
        throw new Error(payload.message || "Unable to load beat docs.");
      }

      setBeatDocsMessage("");
      setBeatDocs(Array.isArray(payload.items) ? payload.items : []);
    } catch (error) {
      setBeatDocs([]);
      setBeatDocsMessage(error.message || "Unable to load beat docs right now.");
    } finally {
      setBeatDocsLoading(false);
    }
  }

  async function persistWriterConfig(targetConfig, options = {}) {
    if (!latestEditUnlockedRef.current) {
      return false;
    }

    const shouldUpdateUi = isMountedRef.current && !options.silent;

    if (shouldUpdateUi) {
      setSaveState("saving");
    }

    try {
      const response = await fetch("/api/tracker-config", {
        method: "PUT",
        keepalive: options.keepalive === true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ config: targetConfig }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        if (response.status === 401 && isMountedRef.current) {
          setEditUnlocked(false);
        }
        throw new Error(payload.error || "Unable to save writer names.");
      }

      configDirtyRef.current = false;
      if (shouldUpdateUi) {
        setSaveState("saved");
      }
      return true;
    } catch (error) {
      if (shouldUpdateUi) {
        setSaveState("error");
        setLoadError(error.message || "Unable to save writer names.");
      }
      return false;
    }
  }

  async function persistWeek(targetWeekKey, targetWeekData, options = {}) {
    if (!latestEditUnlockedRef.current) {
      return false;
    }

    const shouldUpdateUi = isMountedRef.current && !options.silent;

    if (shouldUpdateUi) {
      setSaveState("saving");
    }

    try {
      const response = await fetch(`/api/tracker-week?week=${encodeURIComponent(targetWeekKey)}`, {
        method: "PUT",
        keepalive: options.keepalive === true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          weekData: targetWeekData,
          writerConfig: latestWriterConfigRef.current,
        }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        if (response.status === 401 && isMountedRef.current) {
          setEditUnlocked(false);
        }
        throw new Error(payload.error || "Unable to save changes.");
      }

      weekDirtyRef.current = false;
      if (shouldUpdateUi) {
        setSaveState("saved");
      }
      return true;
    } catch (error) {
      if (shouldUpdateUi) {
        setSaveState("error");
        setLoadError(error.message || "Unable to save changes.");
      }
      return false;
    }
  }

  async function flushPendingSaves(options = {}) {
    if (!latestEditUnlockedRef.current) {
      return true;
    }

    if (weekTimerRef.current) {
      window.clearTimeout(weekTimerRef.current);
      weekTimerRef.current = null;
    }

    if (configTimerRef.current) {
      window.clearTimeout(configTimerRef.current);
      configTimerRef.current = null;
    }

    let ok = true;

    if (configDirtyRef.current) {
      ok =
        (await persistWriterConfig(latestWriterConfigRef.current, {
          silent: options.silent,
          keepalive: options.keepalive,
        })) && ok;
    }

    if (weekDirtyRef.current) {
      ok =
        (await persistWeek(latestWeekKeyRef.current, latestWeekDataRef.current, {
          silent: options.silent,
          keepalive: options.keepalive,
        })) && ok;
    }

    return ok;
  }

  function updateWriterName(podId, writerId, name) {
    if (!canEditRoster) {
      return;
    }

    setWriterConfig((current) => ({
      ...current,
      pods: current.pods.map((pod) =>
        pod.id !== podId
          ? pod
          : {
              ...pod,
              writers: pod.writers.map((writer) =>
                writer.id !== writerId ? writer : { ...writer, name }
              ),
            }
      ),
    }));
  }

  function updateWriterRole(podId, writerId, role) {
    if (!canEditRoster) {
      return;
    }

    setWriterConfig((current) => ({
      ...current,
      pods: current.pods.map((pod) =>
        pod.id !== podId
          ? pod
          : {
              ...pod,
              writers: pod.writers.map((writer) =>
                writer.id !== writerId ? writer : { ...writer, role }
              ),
            }
      ),
    }));
  }

  function addWriterToPod(podId) {
    if (!canEditRoster) {
      return;
    }

    const generatedId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? `writer-${crypto.randomUUID()}`
        : `writer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setWriterConfig((current) => ({
      ...current,
      pods: current.pods.map((pod) => {
        if (pod.id !== podId) {
          return pod;
        }

        const nextWriters = [...pod.writers];
        nextWriters.push({
          id: generatedId,
          name: `New Writer ${nextWriters.filter((writer) => writer.active !== false).length + 1}`,
          role: "Writer",
          displayOrder: nextWriters.length,
          active: true,
        });

        return {
          ...pod,
          writers: nextWriters.map((writer, index) => ({
            ...writer,
            displayOrder: index,
          })),
        };
      }),
    }));
  }

  function deleteWriter(podId, writerId) {
    if (!canEditRoster) return;
    setWriterConfig((current) => ({
      ...current,
      pods: current.pods.map((pod) =>
        pod.id !== podId
          ? pod
          : { ...pod, writers: pod.writers.filter((w) => w.id !== writerId) }
      ),
    }));
  }

  const POD_COLORS = ["#8b5e3c", "#3b6b8c", "#6b3b6b", "#3b6b4e", "#8c6b3b", "#3b4e6b", "#6b4e3b", "#4e6b6b"];

  function addPod() {
    if (!canEditRoster) return;
    const name = window.prompt("Enter POD lead name:");
    if (!name || !name.trim()) return;
    const existingCount = writerConfig?.pods?.length || 0;
    const color = POD_COLORS[existingCount % POD_COLORS.length];
    setWriterConfig((current) => ({
      ...current,
      pods: [
        ...(current.pods || []),
        {
          id: `pod-${Date.now()}`,
          cl: name.trim(),
          color,
          writers: [],
          active: true,
          displayOrder: existingCount,
        },
      ],
    }));
  }

  function deletePod(podId) {
    if (!canEditRoster) return;
    const pod = writerConfig?.pods?.find((p) => p.id === podId);
    if (!pod || !window.confirm(`Delete POD "${pod.cl}" and all its writers?`)) return;
    setWriterConfig((current) => ({
      ...current,
      pods: current.pods.filter((p) => p.id !== podId),
    }));
  }

  function moveWriterToPod(sourcePodId, writerId, targetPodId) {
    if (!canEditRoster || sourcePodId === targetPodId) {
      return;
    }

    setWriterConfig((current) => {
      let selectedWriter = null;
      const nextPods = current.pods.map((pod) => {
        if (pod.id !== sourcePodId) {
          return {
            ...pod,
            writers: pod.writers.map((writer, index) => ({ ...writer, displayOrder: index })),
          };
        }

        const remainingWriters = pod.writers.filter((writer) => {
          if (writer.id === writerId) {
            selectedWriter = writer;
            return false;
          }

          return true;
        });

        return {
          ...pod,
          writers: remainingWriters.map((writer, index) => ({ ...writer, displayOrder: index })),
        };
      });

      if (!selectedWriter) {
        return current;
      }

      return {
        ...current,
        pods: nextPods.map((pod) => {
          if (pod.id !== targetPodId) {
            return pod;
          }

          const movedWriters = [...pod.writers, { ...selectedWriter, active: true }];
          return {
            ...pod,
            writers: movedWriters.map((writer, index) => ({ ...writer, displayOrder: index })),
          };
        }),
      };
    });
  }

  function addBeat(writerId) {
    if (!editUnlocked || plannerInteractionDisabled) return;

    setWeekData((current) => {
      const beats = current?.beats && typeof current.beats === "object" ? current.beats : {};
      const prefix = `${writerId}-beat-`;
      let maxBeatNum = 0;
      for (const key of Object.keys(beats)) {
        if (key.startsWith(prefix)) {
          const num = Number(key.slice(prefix.length));
          if (num > maxBeatNum) maxBeatNum = num;
        }
      }
      const newBeatNum = maxBeatNum + 1;
      const newBeatId = getBeatId(writerId, newBeatNum);

      return {
        ...current,
        beats: {
          ...beats,
          [newBeatId]: createDefaultBeatRecord(newBeatId, newBeatNum),
        },
      };
    });
  }

  function removeBeat(beatId) {
    if (!editUnlocked || plannerInteractionDisabled) return;

    setWeekData((current) => {
      const beats = current?.beats && typeof current.beats === "object" ? current.beats : {};
      if (!beats[beatId]) return current;

      const { [beatId]: _, ...remainingBeats } = beats;
      const removedBeats = Array.isArray(current.removedBeats) ? [...current.removedBeats] : [];
      if (!removedBeats.includes(beatId)) removedBeats.push(beatId);
      return { ...current, beats: remainingBeats, removedBeats };
    });
  }

  function updateBeatFromDoc(beatId, option) {
    if (!editUnlocked || plannerInteractionDisabled) {
      return;
    }

    const safeOption = asObject(option);

    setWeekData((current) => {
      const beats = current?.beats && typeof current.beats === "object" ? current.beats : {};
      const currentBeat = beats[beatId];
      if (!currentBeat) {
        return current;
      }

      return {
        ...current,
        beats: {
          ...beats,
          [beatId]: {
            ...currentBeat,
            beatDocUrl: safeOption.beatDocUrl || "",
            showName: safeOption.showName || currentBeat.showName || "",
            beatTitle: safeOption.beatTitle || currentBeat.beatTitle || "",
            sheetRowId: safeOption.sheetRowId || currentBeat.sheetRowId || "",
          },
        },
      };
    });
  }

  function clearBeatDoc(beatId) {
    if (!editUnlocked || plannerInteractionDisabled) {
      return;
    }

    setWeekData((current) => {
      const beats = current?.beats && typeof current.beats === "object" ? current.beats : {};
      const currentBeat = beats[beatId];
      if (!currentBeat) {
        return current;
      }

      return {
        ...current,
        beats: {
          ...beats,
          [beatId]: {
            ...currentBeat,
            beatTitle: "",
            beatDocUrl: "",
            sheetRowId: "",
          },
        },
      };
    });
  }

  function paintCell(beatId, assetId, dayIndex) {
    if (!editUnlocked || plannerInteractionDisabled) {
      return;
    }

    setWeekData((current) => {
      const beats = current?.beats && typeof current.beats === "object" ? current.beats : {};
      const currentBeat = beats[beatId];
      if (!currentBeat || !Array.isArray(currentBeat.assets)) {
        return current;
      }

      return {
        ...current,
        beats: {
          ...beats,
          [beatId]: {
            ...currentBeat,
            assets: currentBeat.assets.map((asset) => {
              if (asset?.id !== assetId) {
                return asset;
              }

              const dayValues = Array.isArray(asset?.days) ? asset.days : Array(DAYS.length).fill(null);
              return {
                ...asset,
                days: dayValues.map((value, index) => (index === dayIndex ? (eraseMode ? null : activeBrush) : value)),
              };
            }),
          },
        },
      };
    });
  }

  function handlePaintStart(pointerAssetId, beatId, assetId, dayIndex) {
    if (!editUnlocked || isLoading) {
      return;
    }

    dragRef.current = { active: true, assetId: pointerAssetId };
    setIsDragging(true);
    setLoadError("");
    paintCell(beatId, assetId, dayIndex);
  }

  function handlePaintEnter(pointerAssetId, beatId, assetId, dayIndex) {
    if (!dragRef.current.active || dragRef.current.assetId !== pointerAssetId) {
      return;
    }

    paintCell(beatId, assetId, dayIndex);
  }

  function handlePaintEnd() {
    dragRef.current = { active: false, assetId: null };
    setIsDragging(false);
  }

  async function unlockEditMode() {
    if (!authConfigured) {
      setLoadError("Edit access is not configured right now.");
      return false;
    }

    const password = window.prompt("Enter the edit password");
    if (!password) {
      return false;
    }

    setLoadError("");

    try {
      const response = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(payload.error || "Incorrect password.");
      }

      setEditUnlocked(true);
      setSaveState("saved");
      setToast({ tone: "success", text: "Edit mode unlocked." });
      return true;
    } catch (error) {
      setEditUnlocked(false);
      setLoadError(error.message || "Unable to unlock edit mode.");
      return false;
    }
  }

  async function lockEditMode() {
    const didSave = await flushPendingSaves();
    if (!didSave) {
      return;
    }

    try {
      await fetch("/api/auth/lock", { method: "POST" });
    } finally {
      setEditUnlocked(false);
      setEraseMode(false);
      setSaveState("idle");
      setToast({ tone: "success", text: "Edit mode locked." });
    }
  }

  async function changeWeek(delta) {
    const didSave = await flushPendingSaves();
    if (!didSave) {
      return;
    }

    setWeekKey((current) => shiftWeekKey(current, delta));
  }

  async function goToCurrentWeek() {
    const didSave = await flushPendingSaves();
    if (!didSave) {
      return;
    }

    setWeekKey(currentWeekKey);
  }

  async function copyPlannerCapture(options = {}) {
    const {
      successText = "Copied to clipboard.",
      failureText = "Unable to copy this planner view.",
    } = options;
    const didSave = await flushPendingSaves();
    if (!didSave || !captureRef.current || plannerInteractionDisabled) {
      return false;
    }

    setIsCopyingShare(true);

    try {
      await copyNodeImageToClipboard(captureRef.current, {
        backgroundColor: "#f4f0ea",
      });
      setToast({ tone: "success", text: successText });
      return true;
    } catch (error) {
      setToast({
        tone: "error",
        text: error.message || failureText,
      });
      return false;
    } finally {
      setIsCopyingShare(false);
    }
  }

  async function copyPlannerShare() {
    await copyPlannerCapture({ successText: "Copied to clipboard." });
  }

  async function commitNextWeekPlan() {
    if (!isNextWeek || isLoading || plannerInteractionDisabled) {
      return;
    }

    if (
      committedSnapshotMeta?.snapshotTimestamp &&
      typeof window !== "undefined" &&
      !window.confirm("Overwrite existing committed plan?")
    ) {
      return;
    }

    let canCommit = latestEditUnlockedRef.current;
    if (!canCommit) {
      canCommit = await unlockEditMode();
    }

    if (!canCommit) {
      return;
    }

    const didSave = await flushPendingSaves();
    if (!didSave) {
      return;
    }

    setIsCommitting(true);
    setLoadError("");

    try {
      const response = await fetch(`/api/tracker-week?week=${encodeURIComponent(latestWeekKeyRef.current)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          weekData: latestWeekDataRef.current,
          writerConfig: latestWriterConfigRef.current,
        }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        if (response.status === 401 && isMountedRef.current) {
          setEditUnlocked(false);
        }
        throw new Error(payload.error || "Unable to commit next week plan.");
      }

      setCommittedSnapshotMeta(payload.committedSnapshot || null);
      setCommittedSnapshotData({
        weekKey: String(latestWeekKeyRef.current || ""),
        snapshotTimestamp: payload.committedSnapshot?.snapshotTimestamp || new Date().toISOString(),
        rosterSnapshot: latestWriterConfigRef.current,
        weekData: latestWeekDataRef.current,
      });
      await copyPlannerCapture({
        successText: "Committed plan copied",
        failureText: payload.committedSnapshot?.snapshotTimestamp
          ? `Committed on ${formatCommitTimestamp(payload.committedSnapshot.snapshotTimestamp)}, but clipboard copy failed.`
          : "Next week plan committed, but clipboard copy failed.",
      });
    } catch (error) {
      setLoadError(error.message || "Unable to commit next week plan.");
    } finally {
      setIsCommitting(false);
    }
  }

  return (
    <>
      <div
        onPointerUp={handlePaintEnd}
        onPointerLeave={handlePaintEnd}
        style={{
          background: "transparent",
          fontFamily: BODY_FONT,
          userSelect: isDragging ? "none" : "auto",
          touchAction: editUnlocked ? "none" : "auto",
        }}
      >
        <div
          style={{
            background: "var(--card)",
            borderBottom: "1px solid var(--border)",
            padding: "18px 28px",
            color: "var(--ink)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => void changeWeek(-1)} style={navBtn}>
                {"<"}
              </button>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: MONO_FONT,
                  minWidth: 150,
                  textAlign: "center",
                  color: "var(--muted)",
                }}
              >
                {weekLabel}
              </span>
              <button onClick={() => void changeWeek(1)} style={navBtn}>
                {">"}
              </button>

              {weekKey !== currentWeekKey ? (
                <button
                  onClick={() => void goToCurrentWeek()}
                  style={{
                    ...navBtn,
                    width: "auto",
                    padding: "6px 14px",
                    background: "var(--accent)",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  This Week
                </button>
              ) : null}

              <button
                onClick={() => void copyPlannerShare()}
                disabled={isCopyingShare}
                style={{
                  ...navBtn,
                  width: "auto",
                  padding: "6px 14px",
                  background: "var(--accent)",
                  fontSize: 11,
                  fontWeight: 700,
                  opacity: isCopyingShare ? 0.7 : 1,
                  cursor: isCopyingShare ? "not-allowed" : "pointer",
                  color: "#fff",
                }}
                data-share-ignore="true"
              >
                {isCopyingShare ? "Copying..." : "Copy to clipboard"}
              </button>

              {isNextWeek ? (
                <button
                  onClick={() => void commitNextWeekPlan()}
                  disabled={isCommitting}
                  style={{
                    ...navBtn,
                    width: "auto",
                    padding: "6px 14px",
                    background: "var(--forest)",
                    fontSize: 11,
                    fontWeight: 700,
                    opacity: isCommitting ? 0.7 : 1,
                    cursor: isCommitting ? "not-allowed" : "pointer",
                    color: "#fff",
                  }}
                  data-share-ignore="true"
                >
                  {isCommitting ? "Committing..." : "Commit next week plan"}
                </button>
              ) : null}

              <button
                onClick={editUnlocked ? () => void lockEditMode() : () => void unlockEditMode()}
                style={{
                  ...navBtn,
                  width: "auto",
                  padding: "6px 14px",
                  background: editUnlocked ? "var(--accent)" : "var(--bg)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  color: editUnlocked ? "#fff" : "var(--ink)",
                  border: "1px solid var(--border)",
                }}
              >
                {editUnlocked ? "Lock Edit" : "Unlock Edit"}
              </button>

              <div
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: editUnlocked ? "var(--forest)" : "var(--muted)",
                }}
              >
                {sessionChecked ? (editUnlocked ? "Editing enabled" : "Read-only") : "Checking session..."}
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 4px 0", maxWidth: 1280, margin: "0 auto" }}>
          {loadError ? <StatusBanner>{loadError}</StatusBanner> : null}
          {plannerRenderError ? (
            <StatusBanner>
              Planner data was incomplete, so this week is showing a safe fallback view. {plannerRenderError}
            </StatusBanner>
          ) : null}

          {editUnlocked && !canEditRoster ? (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: 14,
                background: "var(--green-bg)",
                color: "var(--forest)",
                border: "1px solid rgba(8, 72, 70, 0.15)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Roster changes are locked on past weeks so their pod and writer snapshots stay historically accurate.
            </div>
          ) : null}

          {isNextWeek && committedSnapshotMeta?.snapshotTimestamp ? (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: 14,
                background: "var(--green-bg)",
                color: "var(--forest)",
                border: "1px solid rgba(8, 72, 70, 0.15)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Committed on {formatCommitTimestamp(committedSnapshotMeta.snapshotTimestamp)}
            </div>
          ) : null}

          {editUnlocked ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 14,
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "10px 14px",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted)",
                  marginRight: 2,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Brush:
              </span>

              {STAGES.map((stage) => (
                <button
                  key={stage.id}
                  onClick={() => {
                    setActiveBrush(stage.id);
                    setEraseMode(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "5px 10px",
                    borderRadius: "var(--radius-sm)",
                    border:
                      activeBrush === stage.id && !eraseMode
                        ? `2px solid ${stage.color}`
                        : "2px solid transparent",
                    background: activeBrush === stage.id && !eraseMode ? stage.bg : "var(--surface)",
                    color: activeBrush === stage.id && !eraseMode ? stage.text : "var(--muted)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: BODY_FONT,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: stage.color }} />
                  {stage.label}
                </button>
              ))}

              <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 2px" }} />

              <button
                onClick={() => setEraseMode((current) => !current)}
                style={{
                  padding: "5px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: eraseMode ? "2px solid var(--red)" : "2px solid transparent",
                  background: eraseMode ? "var(--red-bg)" : "var(--surface)",
                  color: eraseMode ? "var(--red)" : "var(--muted)",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: BODY_FONT,
                }}
              >
                Eraser
              </button>

              <div style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted)" }}>
                {isLoading ? "Loading week..." : statusText(saveState)}
              </div>
            </div>
          ) : null}

          <SummaryChips summary={summary} notStarted={notStarted} totalBeats={totalBeats} notWritingTodayCount={countWritersNotWritingToday(pods, todayIdx)} />

          <RosterManager
            writerConfig={writerConfig}
            editable={canEditRoster}
            isFutureWeek={weekKey > currentWeekKey}
            onWriterNameChange={updateWriterName}
            onWriterRoleChange={updateWriterRole}
            onWriterMovePod={moveWriterToPod}
            onDeleteWriter={deleteWriter}
            onAddWriter={addWriterToPod}
            onAddPod={addPod}
            onDeletePod={deletePod}
          />

          <TrackerTable
            pods={pods}
            weekDates={weekDates}
            todayIdx={todayIdx}
            previousWeekData={previousWeekData}
            useTodayStreakAnchor={weekKey === currentWeekKey && todayIdx >= 0}
            editable={editUnlocked && !plannerInteractionDisabled}
            rosterEditable={canEditRoster && !plannerInteractionDisabled}
            beatDocs={beatDocs}
            beatDocsLoading={beatDocsLoading}
            beatDocsMessage={beatDocsMessage}
            onBeatDocsOpen={() => void loadBeatDocsOnDemand()}
            onWriterNameChange={updateWriterName}
            onAddBeat={addBeat}
            onRemoveBeat={removeBeat}
            onBeatDocSelect={updateBeatFromDoc}
            onBeatDocClear={clearBeatDoc}
            onPaintStart={handlePaintStart}
            onPaintEnter={handlePaintEnter}
          />

          <div style={{ textAlign: "center", fontSize: 10, color: "var(--muted)", marginTop: 12, paddingBottom: 16 }}>
            {plannerRenderError
              ? "This planner week had missing or legacy fields, so a safe read-only fallback is shown instead of crashing the page."
              : editUnlocked
              ? "Select a stage brush, then click and drag across day cells. Click the Beats field to pick a GTG beat from Google Sheets. Use + to split a beat into multiple planner rows."
              : "Read-only mode is active. Unlock edit mode to paint stages, rename writers, set roles, manage planner rows, or assign beats. Share stays available in read-only mode."}
          </div>
        </div>
      </div>

      <div
        style={{
          position: "fixed",
          top: 0,
          left: -20000,
          width: 1500,
          pointerEvents: "none",
          opacity: 1,
          zIndex: -1,
        }}
      >
        <div ref={captureRef}>
          <SnapshotBoard
            weekLabel={weekLabel}
            summary={summary}
            notStarted={notStarted}
            totalBeats={totalBeats}
            pods={pods}
            weekDates={weekDates}
            todayIdx={todayIdx}
            previousWeekData={previousWeekData}
          />
        </div>
      </div>

      <Toast toast={toast} />
    </>
  );
}

const navBtn = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--ink)",
  width: 34,
  height: 34,
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const hdrCell = {
  padding: "10px 10px",
  fontSize: 10,
  fontFamily: BODY_FONT,
  fontWeight: 600,
  color: "var(--muted)",
  background: "var(--card-alt)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  display: "flex",
  alignItems: "center",
  borderRight: "1px solid var(--border)",
};

const inputStyle = {
  width: "100%",
  border: "none",
  background: "transparent",
  fontSize: 11,
  fontFamily: BODY_FONT,
  color: "var(--ink)",
  outline: "none",
  padding: "2px 0",
};

const textStyle = {
  width: "100%",
  fontSize: 11,
  fontFamily: BODY_FONT,
  color: "var(--ink)",
  lineHeight: 1.35,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const subtleTextStyle = {
  width: "100%",
  fontSize: 10,
  fontFamily: BODY_FONT,
  color: "var(--muted)",
  lineHeight: 1.3,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const beatFieldButtonStyle = {
  width: "100%",
  border: "1px solid var(--border)",
  background: "var(--card)",
  borderRadius: "var(--radius-sm)",
  padding: "5px 8px",
  display: "flex",
  alignItems: "center",
  gap: 8,
  cursor: "pointer",
  minHeight: 28,
};

const clearFieldBtnStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  width: 18,
  height: 18,
  fontSize: 10,
  fontWeight: 700,
  color: "var(--muted)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  lineHeight: 1,
  flexShrink: 0,
};

const tinyBtn = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  width: 16,
  height: 16,
  fontSize: 11,
  fontWeight: 700,
  color: "var(--muted)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  lineHeight: 1,
  flexShrink: 0,
};

const pickerMessageStyle = {
  padding: "16px 12px",
  fontSize: 11,
  color: "var(--muted)",
  textAlign: "center",
};

const pickerOptionStyle = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "9px 12px",
  border: "none",
  borderBottom: "1px solid var(--card-alt)",
  background: "transparent",
  cursor: "pointer",
  fontFamily: BODY_FONT,
};
