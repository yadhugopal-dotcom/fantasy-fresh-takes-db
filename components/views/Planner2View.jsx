"use client";

import { useMemo } from "react";
import { DAYS, STAGE_MAP } from "../../lib/tracker-data.js";
import { EmptyState, ShareablePanel, formatDateTimeLabel, formatNumber } from "./shared.jsx";

const GRID_TEMPLATE_COLUMNS = "80px 130px 420px repeat(7, 1fr)";
const POD_COLOR_MAP = {
  Berman: "#1e3a5f",
  Roth: "#5b21b6",
  Lee: "#1e40af",
  Gilatar: "#0d9488",
  Woodward: "#0f766e",
  Unmapped: "#334155",
};

function toneClassFromLag(laggingCount) {
  const value = Number(laggingCount || 0);
  if (value >= 5) return "tone-danger";
  if (value >= 2) return "tone-warning";
  return "tone-positive";
}

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
  if (committed <= 0) return null;
  if (lagging > 0) return "cl_review";
  if (completed >= committed) return "live_on_meta";
  if (completed > 0) return "production";
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
  const totals = planner2Data?.totals || {};
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
      })),
    [plannerRows, weekDates]
  );

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

        <div className="metrics-grid" style={{ marginBottom: 12 }}>
          <div className="metric-card">
            <div className="metric-label">Committed tasks</div>
            <div className="metric-value">{formatNumber(totals.committedTaskCount || 0)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Completed markers</div>
            <div className="metric-value">{formatNumber(totals.completedTaskCount || 0)}</div>
          </div>
          <div className={`metric-card ${toneClassFromLag(totals.laggingTaskCount)}`}>
            <div className="metric-label">Lagging</div>
            <div className="metric-value">{formatNumber(totals.laggingTaskCount || 0)}</div>
          </div>
        </div>

        <div className="table-wrap">
          {ganttRows.length > 0 ? (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e0d5c7",
                borderRadius: 14,
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
                overflow: "auto",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
                  minWidth: 940,
                  borderBottom: "1px solid #e0d5c7",
                }}
              >
                {["Pod", "Writer", "Beats"].map((label) => (
                  <div key={label} style={{ fontSize: 11, fontWeight: 700, color: "#8c847d", letterSpacing: "0.08em", textTransform: "uppercase", padding: "8px 6px", background: "#faf7f3", borderRight: "1px solid #e0d5c7", display: "flex", alignItems: "center" }}>
                    {label}
                  </div>
                ))}
                {weekDates.map((date, index) => (
                  <div
                    key={date}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#8c847d",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      padding: "8px 6px",
                      textAlign: "center",
                      justifyContent: "center",
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                      background: index === 0 ? "#c4704b" : "#faf7f3",
                      borderRight: "1px solid #e0d5c7",
                    }}
                  >
                    <span style={{ color: index === 0 ? "#fff" : undefined }}>{DAYS[index] || "-"}</span>
                    <span style={{ fontSize: 9, opacity: 0.85, color: index === 0 ? "#fff" : undefined }}>
                      {formatPlanner2DayLabel(date)}
                    </span>
                  </div>
                ))}
              </div>

              {ganttRows.map((row, rowIndex) => (
                <div
                  key={`${row.podLeadName}-${row.ownerName}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
                    minWidth: 940,
                    minHeight: 34,
                    background: rowIndex % 2 === 0 ? "#ffffff" : "#faf7f3",
                  }}
                >
                  <div
                    style={{
                      background: POD_COLOR_MAP[row.podLeadName] || POD_COLOR_MAP.Unmapped,
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 13,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      textAlign: "center",
                      padding: "6px 4px",
                      borderRight: "1px solid rgba(255,255,255,0.15)",
                      borderBottom: "1px solid #cbd5e1",
                    }}
                  >
                    {row.podLeadName}
                  </div>
                  <div
                    style={{
                      padding: "3px 6px",
                      background: "#faf7f3",
                      borderRight: "1px solid #e0d5c7",
                      display: "flex",
                      alignItems: "center",
                      borderBottom: "1px solid #cbd5e1",
                      fontWeight: 600,
                    }}
                  >
                    {row.ownerName || "-"}
                  </div>
                  <div
                    style={{
                      padding: "3px 6px",
                      borderRight: "1px solid #e0d5c7",
                      display: "flex",
                      alignItems: "center",
                      borderBottom: "1px solid #cbd5e1",
                      color: "#6b6560",
                    }}
                  >
                    {`Committed ${formatNumber(row.committedTaskCount)} · Done ${formatNumber(row.completedTaskCount)} · Lag ${formatNumber(row.laggingTaskCount)}`}
                  </div>
                  {DAYS.map((_, dayIndex) => {
                    const stageId = row.days[dayIndex] || null;
                    const previousStage = dayIndex > 0 ? row.days[dayIndex - 1] : null;
                    const nextStage = dayIndex < DAYS.length - 1 ? row.days[dayIndex + 1] : null;
                    return (
                      <div
                        key={`${row.ownerName}-${dayIndex}`}
                        style={{
                          position: "relative",
                          minHeight: 32,
                          borderRight: dayIndex < DAYS.length - 1 ? "1px solid #f3eadb" : "none",
                          borderBottom: "1px solid #cbd5e1",
                          background: dayIndex === 0 ? "rgba(0,106,103,0.05)" : "transparent",
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
              ))}
            </div>
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
