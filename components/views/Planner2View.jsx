"use client";

import { useMemo } from "react";
import { DAYS, STAGE_MAP } from "../../lib/tracker-data.js";
import { EmptyState, ShareablePanel, formatDateTimeLabel, formatNumber } from "./shared.jsx";

const POD_COLOR_MAP = {
  Berman: "#1e3a5f",
  Roth: "#5b21b6",
  Lee: "#1e40af",
  Gilatar: "#0d9488",
  Woodward: "#0f766e",
  Unmapped: "#334155",
};
const POD_ORDER = ["Woodward", "Berman", "Roth", "Lee", "Gilatar", "Unmapped"];

function formatPlanner2DayLabel(dateValue) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateValue;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function stageIdForPlannerCell(cell) {
  const committed = Number(cell?.committedTaskCount || 0);
  const completed = Number(cell?.completedTaskCount || 0);
  const lagging = Number(cell?.laggingTaskCount || 0);
  const noteText = Array.isArray(cell?.notes)
    ? cell.notes.join(" ").toLowerCase()
    : String(cell?.notes || "").toLowerCase();
  if (committed <= 0) return null;

  // Prefer explicit signal from task text if available.
  if (/(live|published|approved|final pass|uploaded)/.test(noteText)) return "live_on_meta";
  if (/(production|promo|canvas|render)/.test(noteText)) return "production";
  if (/(review|cl review|feedback)/.test(noteText)) return "cl_review";
  if (/(write|writing|script|draft|ideation|beat)/.test(noteText)) return "writing";

  // Fallback to progress-based inference.
  if (completed >= committed) return "live_on_meta";
  if (completed > 0) return "production";
  if (lagging > 0) return "writing";
  return "writing";
}

function normalizeAngleLabel(value) {
  return String(value || "")
    .replace(/^[\-\u2022\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBeatCandidate(value) {
  let text = normalizeAngleLabel(value);
  if (!text) return "";
  text = text
    .replace(/^(write|writing|finish|finished|review|cl review|revise|draft|production|live)\s*[:\-]\s*/i, "")
    .replace(/^(write|writing|finish|finished|review|cl review|revise|draft|production|live)\s+/i, "")
    .trim();
  return text;
}

function isGenericTaskLine(text) {
  const key = normalizeAngleLabel(text).toLowerCase();
  if (!key) return true;
  if (/(?:^|\b)(write|writing|finish|finished|review|cl review|revise|draft|rework|sync|meeting|follow up|check-in|todo)(?:\b|$)/.test(key)) {
    return true;
  }
  return false;
}

function extractWriterAngles(dayMap, weekDates) {
  const seen = new Set();
  const angles = [];
  for (const date of weekDates) {
    const notes = Array.isArray(dayMap?.[date]?.notes) ? dayMap[date].notes : [];
    for (const note of notes) {
      const clean = normalizeBeatCandidate(note);
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      angles.push(clean);
      if (angles.length >= 3) return angles;
    }
  }
  return angles;
}

function isMeaningfulBeatLine(value) {
  const text = normalizeAngleLabel(value);
  const key = text.toLowerCase();
  if (!text) return false;
  const blocked = [
    "due eod",
    "ooo",
    "training",
    "reading",
    "out of office",
    "contingent",
    "wip",
  ];
  if (blocked.some((term) => key === term || key.includes(term))) return false;
  if (text.length < 3) return false;
  const hasStructuredSeparator = / - | — |:|\|/.test(text);
  if (isGenericTaskLine(text) && !hasStructuredSeparator) return false;
  if (!hasStructuredSeparator && text.split(/\s+/).length < 2) return false;
  return true;
}

function normalizeBeatKey(value) {
  return normalizeAngleLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseBeatDisplay(value) {
  const text = normalizeBeatCandidate(value);
  if (!text) return { title: "-", subtitle: "" };
  const separators = [" - ", " — ", ":", "|"];
  for (const sep of separators) {
    if (text.includes(sep)) {
      const [head, second] = text
        .split(sep)
        .map((part) => normalizeAngleLabel(part))
        .filter(Boolean);
      if (head && second) {
        return { title: head, subtitle: second };
      }
    }
  }
  if (text.includes("(") && text.includes(")")) {
    const head = normalizeAngleLabel(text.replace(/\(.*?\)/g, ""));
    const paren = text.match(/\((.*?)\)/)?.[1] || "";
    return { title: head || text, subtitle: normalizeAngleLabel(paren) };
  }
  return { title: text, subtitle: "" };
}

function StageBar({ stageId, isStart, isEnd }) {
  if (!stageId || !STAGE_MAP[stageId]) return null;
  const stage = STAGE_MAP[stageId];
  return (
    <div
      style={{
        position: "absolute",
        top: 3,
        bottom: 3,
        left: isStart ? 3 : 0,
        right: isEnd ? 3 : 0,
        background: stage.color,
        borderRadius: `${isStart ? 5 : 0}px ${isEnd ? 5 : 0}px ${isEnd ? 5 : 0}px ${isStart ? 5 : 0}px`,
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

const PLANNER2_STAGE_LEGEND = ["writing", "cl_review", "production", "live_on_meta", "beats_ideation"];

export default function Planner2Content({
  planner2Data,
  planner2Loading,
  planner2Error,
  onShare,
  copyingSection,
}) {
  const plannerRows = Array.isArray(planner2Data?.plannerRows) ? planner2Data.plannerRows : [];
  const dateColumns = Array.isArray(planner2Data?.dateColumns) ? planner2Data.dateColumns : [];
  const weekDates = dateColumns.slice(0, 7);
  const summaryMetrics = useMemo(() => {
    const beatSet = new Set();
    let expectedInProduction = 0;
    let expectedLive = 0;
    let writerOoo = 0;
    const firstDay = weekDates[0] || "";
    let notWritingToday = 0;

    for (const row of plannerRows) {
      const dayMap = row?.dayMap || {};
      const firstDayCommitted = Number(dayMap?.[firstDay]?.committedTaskCount || 0);
      if (firstDay && firstDayCommitted === 0) {
        notWritingToday += 1;
      }

      let hasAnyTask = false;
      for (const date of weekDates) {
        const cell = dayMap?.[date] || {};
        const notes = Array.isArray(cell.notes) ? cell.notes : [];
        for (const note of notes) {
          const text = normalizeAngleLabel(note);
          if (isMeaningfulBeatLine(text)) {
            beatSet.add(normalizeBeatKey(text));
            hasAnyTask = true;
          }
          if (/\booo\b|out of office/i.test(text)) {
            writerOoo += 1;
          }
        }
        const stage = stageIdForPlannerCell(cell);
        if (stage === "production") expectedInProduction += 1;
        if (stage === "live_on_meta") expectedLive += 1;
      }
      if (!hasAnyTask && firstDay && firstDayCommitted === 0) {
        notWritingToday += 0;
      }
    }

    return {
      beatsThisWeek: beatSet.size,
      expectedInProduction,
      expectedLive,
      writerOoo,
      notWritingToday,
    };
  }, [plannerRows, weekDates]);
  const ganttRows = useMemo(() => {
    return plannerRows.flatMap((row) => {
      const podLeadName = String(row?.podLeadName || "Unmapped").trim() || "Unmapped";
      const ownerName = String(row?.ownerName || "").trim();
      const writerRole =
        ownerName.toLowerCase() === String(row?.podLeadName || "").trim().toLowerCase() ? "Pod Lead" : "Writer";
      const dayMap = row?.dayMap || {};

      const beatCandidates = extractWriterAngles(dayMap, weekDates).filter(isMeaningfulBeatLine);
      const beats = beatCandidates.length > 0 ? beatCandidates.slice(0, 3) : ["General planning"];
      const beatRows = beats.map((beatLabel, index) => {
        const beatKey = normalizeBeatKey(beatLabel);
        const days = weekDates.map((date) => {
          const cell = dayMap?.[date] || {};
          const notes = Array.isArray(cell.notes) ? cell.notes : [];
          const matched = notes.some((note) => {
            const noteKey = normalizeBeatKey(note);
            return noteKey && beatKey && (noteKey.includes(beatKey) || beatKey.includes(noteKey));
          });
          return matched ? stageIdForPlannerCell(cell) : null;
        });

        return {
          podLeadName,
          ownerName,
          writerRole,
          beatLabel,
          beatDisplay: parseBeatDisplay(beatLabel),
          days,
          isFirstBeat: index === 0,
        };
      });

      const hasAnyStage = beatRows.some((entry) => entry.days.some(Boolean));
      if (!hasAnyStage && beatRows.length > 0) {
        beatRows[0].days = weekDates.map((date) => stageIdForPlannerCell(dayMap?.[date]));
      }

      return beatRows;
    });
  }, [plannerRows, weekDates]);
  const groupedGanttRows = useMemo(() => {
    const podMap = new Map();
    for (const row of ganttRows) {
      const pod = row.podLeadName || "Unmapped";
      if (!podMap.has(pod)) podMap.set(pod, []);
      podMap.get(pod).push(row);
    }
    return Array.from(podMap.entries())
      .sort((a, b) => {
        const ia = POD_ORDER.indexOf(a[0]);
        const ib = POD_ORDER.indexOf(b[0]);
        const aa = ia === -1 ? 999 : ia;
        const bb = ib === -1 ? 999 : ib;
        if (aa !== bb) return aa - bb;
        return a[0].localeCompare(b[0]);
      })
      .map(([pod, rows]) => ({
        pod,
        rows: [...rows].sort((x, y) => x.ownerName.localeCompare(y.ownerName) || String(x.beatLabel).localeCompare(String(y.beatLabel))),
      }));
  }, [ganttRows]);

  if (planner2Loading && !planner2Data) {
    return <EmptyState text="Loading Planner2..." />;
  }

  if (planner2Error && !planner2Data) {
    return <div className="warning-note">{planner2Error}</div>;
  }

  if (!planner2Data) {
    return <EmptyState text="Planner2 data is not available right now." />;
  }

  return (
    <div className="section-stack">
      {planner2Error ? <div className="warning-note">{planner2Error}</div> : null}

      <ShareablePanel
        shareLabel={`Planner2 ${planner2Data?.weekLabel || ""}`.trim()}
        onShare={onShare}
        isSharing={copyingSection === `Planner2 ${planner2Data?.weekLabel || ""}`.trim()}
      >
        <div className="panel-head">
          <div>
            <div className="panel-title">Planner2 · Planning Board</div>
            <div className="panel-statline">
              <span>{planner2Data?.weekLabel || "-"}</span>
              {planner2Data?.lastUpdatedAt ? (
                <span>Last updated: {formatDateTimeLabel(planner2Data.lastUpdatedAt)}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          {[
            { label: "Beats this week", value: summaryMetrics.beatsThisWeek, color: "#1a6b5a" },
            { label: "Expected in Production", value: summaryMetrics.expectedInProduction, color: "#1a6b5a" },
            { label: "Expected Live", value: summaryMetrics.expectedLive, color: "#1a6b5a" },
            { label: "Writer OOO", value: summaryMetrics.writerOoo, color: "#8c847d" },
            { label: "Not writing today", value: summaryMetrics.notWritingToday, color: "#c24141" },
          ].map((metric) => (
            <div
              key={metric.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: "#fff",
                border: "1px solid #e0d5c7",
                borderRadius: 16,
                borderLeft: `5px solid ${metric.color}`,
                minWidth: 190,
              }}
            >
              <span style={{ fontSize: 28, lineHeight: 1, fontWeight: 700, color: metric.color }}>
                {formatNumber(metric.value)}
              </span>
              <span style={{ fontSize: 20, lineHeight: 1, color: "#b8b2a8" }}>·</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-secondary)" }}>{metric.label}</span>
            </div>
          ))}
        </div>

        <div className="planner2-clean-layer">
          <div className="planner2-clean-label">Stage key</div>
          <div className="planner2-clean-legends">
            {PLANNER2_STAGE_LEGEND.map((stageId) => {
              const stage = STAGE_MAP[stageId];
              if (!stage) return null;
              return (
                <span key={stageId} className="planner2-clean-chip" style={{ background: stage.color }}>
                  {stage.label}
                </span>
              );
            })}
            <span className="planner2-clean-chip planner2-clean-chip-live">Live this week</span>
            <span className="planner2-clean-chip planner2-clean-chip-not-live">Not live yet</span>
          </div>
        </div>

        <div className="table-wrap">
          {ganttRows.length > 0 ? (
            <table className="ops-table overview-table planner2-table" style={{ minWidth: 940 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }} className="planner2-col-pod">Pod</th>
                  <th style={{ width: 190 }} className="planner2-col-writer">Writer</th>
                  <th style={{ width: 300 }} className="planner2-col-beat">Beats</th>
                  {weekDates.map((date, index) => (
                    <th key={date} style={{ minWidth: 90, textAlign: "center" }}>
                      <div>{DAYS[index] || "-"}</div>
                      <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.8 }}>{formatPlanner2DayLabel(date)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedGanttRows.map((group) =>
                  group.rows.map((row, rowIndexInPod) => {
                    const writerRowCount = group.rows.filter((item) => item.ownerName === row.ownerName).length;
                    const writerFirstIndex = group.rows.findIndex((item) => item.ownerName === row.ownerName);
                    const isFirstWriterRow = writerFirstIndex === rowIndexInPod;
                    const writerRows = group.rows.filter((item) => item.ownerName === row.ownerName);
                    const ideationDays = writerRows.reduce(
                      (sum, item) => sum + item.days.filter((stage) => stage === "beats_ideation").length,
                      0
                    );
                    const hasLive = writerRows.some((item) => item.days.some((stage) => stage === "live_on_meta"));
                    return (
                    <tr key={`${group.pod}-${row.ownerName}`}>
                      {rowIndexInPod === 0 ? (
                        <td
                          rowSpan={group.rows.length}
                          className="planner2-col-pod"
                          style={{
                            background: POD_COLOR_MAP[group.pod] || POD_COLOR_MAP.Unmapped,
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: 15,
                            textAlign: "center",
                            verticalAlign: "top",
                            paddingTop: 18,
                          }}
                        >
                          {group.pod}
                        </td>
                      ) : null}
                      {isFirstWriterRow ? (
                        <td style={{ background: "#faf7f3", verticalAlign: "top" }} className="planner2-col-writer" rowSpan={writerRowCount}>
                          <div style={{ fontWeight: 700, fontSize: 18 }}>{row.ownerName || "-"}</div>
                          <div style={{ color: "var(--subtle)", fontSize: 12 }}>{row.writerRole}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                            {ideationDays > 0 ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: "#b4233c",
                                  border: "1px solid rgba(180, 35, 60, 0.28)",
                                  background: "rgba(180, 35, 60, 0.06)",
                                }}
                              >
                                {`${ideationDays} day${ideationDays === 1 ? "" : "s"} in beats ideation`}
                              </span>
                            ) : null}
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                padding: "2px 8px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 700,
                                color: hasLive ? "#166534" : "#9a3412",
                                border: `1px solid ${hasLive ? "rgba(22, 101, 52, 0.28)" : "rgba(154, 52, 18, 0.28)"}`,
                                background: hasLive ? "rgba(22, 101, 52, 0.08)" : "rgba(154, 52, 18, 0.08)",
                              }}
                            >
                              {hasLive ? "Live this week" : "Not live yet"}
                            </span>
                          </div>
                        </td>
                      ) : null}
                      <td style={{ background: "#faf7f3", verticalAlign: "top" }} className="planner2-col-beat">
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{row.beatDisplay.title || "-"}</div>
                        {row.beatDisplay.subtitle ? (
                          <div style={{ color: "var(--subtle)", fontSize: 12 }}>{row.beatDisplay.subtitle}</div>
                        ) : null}
                      </td>
                      {DAYS.map((_, dayIndex) => {
                        const stageId = row.days[dayIndex] || null;
                        const previousStage = dayIndex > 0 ? row.days[dayIndex - 1] : null;
                        const nextStage = dayIndex < DAYS.length - 1 ? row.days[dayIndex + 1] : null;
                        return (
                          <td
                            key={`${row.ownerName}-${dayIndex}`}
                            style={{
                              position: "relative",
                              minHeight: 36,
                              background: dayIndex === 0 ? "rgba(0,106,103,0.05)" : "transparent",
                            }}
                          >
                            <StageBar
                              stageId={stageId}
                              isStart={Boolean(stageId && stageId !== previousStage)}
                              isEnd={Boolean(stageId && stageId !== nextStage)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <EmptyState text="No planning rows found for this date range." />
          )}
        </div>
      </ShareablePanel>
    </div>
  );
}
