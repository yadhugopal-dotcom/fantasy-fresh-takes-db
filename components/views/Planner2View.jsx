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

export default function Planner2Content({
  planner2Data,
  planner2Loading,
  planner2Error,
  onShare,
  copyingSection,
}) {
  const ownerRows = Array.isArray(planner2Data?.ownerRows) ? planner2Data.ownerRows : [];
  const plannerRows = Array.isArray(planner2Data?.plannerRows) ? planner2Data.plannerRows : [];
  const dateColumns = Array.isArray(planner2Data?.dateColumns) ? planner2Data.dateColumns : [];
  const dayRows = Array.isArray(planner2Data?.dayRows) ? planner2Data.dayRows : [];
  const weekDates = dateColumns.slice(0, 7);
  const ganttRows = useMemo(
    () =>
      plannerRows.map((row) => ({
        podLeadName: String(row?.podLeadName || "Unmapped").trim() || "Unmapped",
        ownerName: String(row?.ownerName || "").trim(),
        committedTaskCount: Number(row?.committedTaskCount || 0),
        completedTaskCount: Number(row?.completedTaskCount || 0),
        laggingTaskCount: Number(row?.laggingTaskCount || 0),
        days: weekDates.map((date) => stageIdForPlannerCell(row?.dayMap?.[date])),
        writerRole:
          String(row?.ownerName || "").trim().toLowerCase() === String(row?.podLeadName || "").trim().toLowerCase()
            ? "Pod Lead"
            : "Writer",
      })),
    [plannerRows, weekDates]
  );
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
        rows: [...rows].sort((x, y) => x.ownerName.localeCompare(y.ownerName)),
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

        <div className="table-wrap">
          {ganttRows.length > 0 ? (
            <table className="ops-table overview-table" style={{ minWidth: 940 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Pod</th>
                  <th style={{ width: 190 }}>Writer</th>
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
                  group.rows.map((row, rowIndexInPod) => (
                    <tr key={`${group.pod}-${row.ownerName}`}>
                      {rowIndexInPod === 0 ? (
                        <td
                          rowSpan={group.rows.length}
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
                      <td style={{ background: "#faf7f3" }}>
                        <div style={{ fontWeight: 700, fontSize: 18 }}>{row.ownerName || "-"}</div>
                        <div style={{ color: "var(--subtle)", fontSize: 12 }}>{row.writerRole}</div>
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
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <EmptyState text="No planning rows found for this date range." />
          )}
        </div>

        <div className="table-wrap">
          <table className="ops-table overview-table">
            <thead>
              <tr>
                <th>Owner</th>
                <th>POD lead</th>
                <th>Committed</th>
                <th>Completed</th>
                <th>Lagging</th>
                <th>Active days</th>
              </tr>
            </thead>
            <tbody>
              {ownerRows.length > 0 ? (
                ownerRows.map((row) => (
                  <tr key={`${row.podLeadName}-${row.ownerName}`} className={Number(row.laggingTaskCount || 0) > 0 ? "is-below-target" : ""}>
                    <td>{row.ownerName || "-"}</td>
                    <td>{row.podLeadName || "-"}</td>
                    <td>{formatNumber(row.committedTaskCount || 0)}</td>
                    <td>{formatNumber(row.completedTaskCount || 0)}</td>
                    <td>{formatNumber(row.laggingTaskCount || 0)}</td>
                    <td>{formatNumber(row.activeDays || 0)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="empty-cell">
                    No planning rows found for this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ShareablePanel>

      <ShareablePanel
        shareLabel="Planner2 daily plan"
        onShare={onShare}
        isSharing={copyingSection === "Planner2 daily plan"}
      >
        <div className="panel-title">Daily plan grid (from committed planner sheet)</div>
        <div className="panel-statline">Use this to share in leads channel and track daily execution.</div>
        <div className="table-wrap">
          <table className="ops-table overview-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Owners with planned items</th>
                <th>Total committed</th>
                <th>Total completed markers</th>
                <th>Total lagging</th>
              </tr>
            </thead>
            <tbody>
              {dayRows.length > 0 ? (
                dayRows.map((row) => {
                  const totalsForDay = (Array.isArray(row.items) ? row.items : []).reduce(
                    (acc, item) => {
                      acc.committed += Number(item.committedTaskCount || 0);
                      acc.completed += Number(item.completedTaskCount || 0);
                      acc.lagging += Number(item.laggingTaskCount || 0);
                      return acc;
                    },
                    { committed: 0, completed: 0, lagging: 0 }
                  );
                  return (
                    <tr key={row.date} className={totalsForDay.lagging > 0 ? "is-below-target" : ""}>
                      <td>{row.date || "-"}</td>
                      <td>{formatNumber((row.items || []).length)}</td>
                      <td>{formatNumber(totalsForDay.committed)}</td>
                      <td>{formatNumber(totalsForDay.completed)}</td>
                      <td>{formatNumber(totalsForDay.lagging)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="5" className="empty-cell">
                    No daily plan rows found for this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ShareablePanel>
    </div>
  );
}
