"use client";

import {
  EmptyState,
  ShareablePanel,
  formatMetricValue,
} from "./shared.jsx";

// ─── Private components ───────────────────────────────────────────────────────

const POD_TIER_GREEN_MIN = 35;
const POD_TIER_AMBER_MIN = 20;

function getPodTierColor(conversionRate) {
  if (conversionRate >= POD_TIER_GREEN_MIN) return "#2d5a3d";
  if (conversionRate >= POD_TIER_AMBER_MIN) return "#c2703e";
  return "#9f2e2e";
}

function PodFunnelBar({ label, value, maxValue, color }) {
  const pct = maxValue > 0 ? Math.max((value / maxValue) * 100, 2) : 0;
  return (
    <div className="pod-funnel-row">
      <span className="pod-funnel-label">{label}</span>
      <div className="pod-funnel-track">
        <div className="pod-funnel-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="pod-funnel-count">{value}</span>
    </div>
  );
}

// ─── PodTasksBarChart and PodTasksContent ────────────────────────────────────

function PodTasksBarChart({ title, subtitle, items, maxValue, accentColor }) {
  if (items.length === 0) {
    return (
      <>
        <div className="pod-section-header">
          <span className="pod-section-title">{title}</span>
          <span className="pod-section-subtitle">{subtitle}</span>
        </div>
        <EmptyState text={`No ${title.toLowerCase()} right now.`} />
      </>
    );
  }

  return (
    <>
      <div className="pod-section-header">
        <span className="pod-section-title">{title}</span>
        <span className="pod-section-subtitle">{subtitle}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => {
          const isMax = i === 0;
          const barColor = isMax ? accentColor : "#2d5a3d";
          const pct = maxValue > 0 ? Math.max((item.count / maxValue) * 100, 4) : 0;
          return (
            <div key={item.podLead} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 72, fontSize: 13, fontWeight: 500, color: "var(--ink)", textAlign: "right", flexShrink: 0 }}>
                {item.podLead}
              </span>
              <div style={{ flex: 1, height: 28, borderRadius: 6, background: "var(--surface)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", borderRadius: 6, background: barColor, transition: "width 0.4s ease" }} />
              </div>
              <span style={{ width: 28, fontSize: 14, fontWeight: 700, color: isMax ? accentColor : "var(--ink-secondary)", textAlign: "right", flexShrink: 0 }}>
                {item.count}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function PodTasksContent({ podTasksData, podTasksLoading, onShare, copyingSection }) {
  if (podTasksLoading) {
    return <EmptyState text="Loading POD tasks..." />;
  }

  if (!podTasksData) {
    return <EmptyState text="POD tasks data is not available right now." />;
  }

  const { scriptsPendingByPod, beatsPendingByPod, totalScriptsPending, totalBeatsPending } = podTasksData;
  const maxScripts = Math.max(...scriptsPendingByPod.map((r) => r.count), 1);
  const maxBeats = Math.max(...beatsPendingByPod.map((r) => r.count), 1);

  return (
    <ShareablePanel
      shareLabel="POD Tasks"
      onShare={onShare}
      isSharing={copyingSection === "POD Tasks"}
    >
      <div className="section-stack">
        <div className="pod-summary-grid">
          {[
            { label: "Scripts to review", value: totalScriptsPending },
            { label: "Beats to review", value: totalBeatsPending },
          ].map((card) => (
            <div key={card.label} className="metric-card">
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">{card.value}</div>
            </div>
          ))}
        </div>

        <PodTasksBarChart
          title="Scripts pending approval"
          subtitle="Scripts completed by writer, awaiting POD lead review"
          items={scriptsPendingByPod}
          maxValue={maxScripts}
          accentColor="#c2703e"
        />

        <PodTasksBarChart
          title="Beats pending approval"
          subtitle="Beats from current week in review pending or iterate status"
          items={beatsPendingByPod}
          maxValue={maxBeats}
          accentColor="#c2703e"
        />
      </div>
    </ShareablePanel>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function PodWiseContent({
  competitionPodRows,
  competitionLoading,
  competitionWeekLabel,
  performanceRangeMode,
  onPerformanceRangeModeChange,
  performanceScope,
  onPerformanceScopeChange,
  onShare,
  copyingSection,
}) {
  if (competitionLoading) {
    return <EmptyState text="Loading POD Wise dashboard..." />;
  }

  const competitionRows = Array.isArray(competitionPodRows) ? competitionPodRows : [];
  if (competitionRows.length === 0) {
    return <EmptyState text="POD Wise data is not available right now." />;
  }

  const sorted = [...competitionRows]
    .map((row) => {
      const beats = row.lifetimeBeats || 0;
      const scripts = row.lifetimeScripts || 0;
      const successful = row.hitRateNumerator || 0;
      const throughputScore = row.throughputScore || successful;
      const conversion = scripts > 0 ? Math.round((successful / scripts) * 100) : 0;
      return { ...row, beats, scripts, successful, conversion, throughputScore };
    })
    .sort((a, b) => b.throughputScore - a.throughputScore || b.successful - a.successful || b.conversion - a.conversion);

  const bestPod = sorted[0] || null;

  const totalBeats = sorted.reduce((s, r) => s + r.beats, 0);
  const totalScripts = sorted.reduce((s, r) => s + r.scripts, 0);
  const totalSuccessful = sorted.reduce((s, r) => s + r.successful, 0);
  const avgConversion = totalScripts > 0 ? Math.round((totalSuccessful / totalScripts) * 100) : 0;

  const maxBeats = Math.max(...sorted.map((r) => r.beats), 1);
  const maxScripts = Math.max(...sorted.map((r) => r.scripts), 1);
  const maxSuccessful = Math.max(...sorted.map((r) => r.successful), 1);

  return (
    <ShareablePanel
      shareLabel="POD Wise leaderboard"
      onShare={onShare}
      isSharing={copyingSection === "POD Wise leaderboard"}
    >
      <div className="section-stack">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="week-toggle-group">
            {[
              { id: "selected", label: "Selected range" },
              { id: "lifetime", label: "Lifetime (Mar 16+)" },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={performanceRangeMode === opt.id ? "is-active" : ""}
                onClick={() => onPerformanceRangeModeChange?.(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="week-toggle-group">
            {[
              { id: "bau", label: "BAU" },
              { id: "bau-lt", label: "BAU + LT" },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={performanceScope === opt.id ? "is-active" : ""}
                onClick={() => onPerformanceScopeChange?.(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {competitionWeekLabel ? (
          <div style={{ fontSize: 11, color: "var(--subtle)", marginTop: -6 }}>{competitionWeekLabel}</div>
        ) : null}

        {bestPod ? (
          <div className="metric-card" style={{ borderLeft: "4px solid var(--accent)" }}>
            <div className="metric-label">Best POD</div>
            <div className="metric-value" style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span>{bestPod.podLeadName}</span>
              <span style={{ fontSize: 16, color: "var(--subtle)" }}>Score: {formatMetricValue(bestPod.throughputScore)}</span>
            </div>
            <div className="metric-hint">
              POD Lead x Writers ({formatMetricValue(bestPod.writerCount)}) x Output ({formatMetricValue(bestPod.scripts)}) x Success ({formatMetricValue(bestPod.successful)})
            </div>
          </div>
        ) : null}

        <div className="pod-summary-grid">
          {[
            { label: "Total beats", value: totalBeats },
            { label: "Total scripts", value: totalScripts },
            { label: "Successful", value: totalSuccessful },
            { label: "Avg conversion", value: `${avgConversion}%` },
          ].map((card) => (
            <div key={card.label} className="metric-card">
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">{card.value}</div>
            </div>
          ))}
        </div>

        <div className="pod-section-header">
          <span className="pod-section-title">POD performance</span>
          <span className="pod-section-subtitle">Ranked by throughput score (successful beats/scripts)</span>
        </div>

        <div className="pod-cards-stack">
          {sorted.map((pod, i) => {
            const rank = i + 1;
            const tierColor = getPodTierColor(pod.conversion);
            return (
              <div key={pod.podLeadName} className="pod-rank-card" style={{ borderLeftColor: tierColor }}>
                <div className="pod-rank-col">
                  <div className="pod-rank-number" style={{ color: tierColor }}>{rank}</div>
                  <div className="pod-rank-label">RANK</div>
                </div>
                <div className="pod-info-col">
                  <div className="pod-lead-name">{pod.podLeadName}</div>
                  <div className="pod-conversion" style={{ color: tierColor }}>{pod.conversion}%</div>
                  <div className="pod-rate-label">SCRIPT HIT RATE</div>
                </div>
                <div className="pod-bars-col">
                  <PodFunnelBar label="Beats" value={pod.beats} maxValue={maxBeats} color="#2d5a3d" />
                  <PodFunnelBar label="Scripts" value={pod.scripts} maxValue={maxScripts} color="#c2703e" />
                  <PodFunnelBar label="Success" value={pod.successful} maxValue={maxSuccessful} color="#2d5a3d" />
                </div>
              </div>
            );
          })}
        </div>

        <div className="table-wrap">
          <table className="ops-table overview-table">
            <thead>
              <tr>
                <th>POD lead</th>
                <th>Writers</th>
                <th>Output</th>
                <th>Success</th>
                <th>Throughput score</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={`pod-score-${row.podLeadName}`}>
                  <td>{row.podLeadName}</td>
                  <td>{formatMetricValue(row.writerCount)}</td>
                  <td>{formatMetricValue(row.scripts)}</td>
                  <td>{formatMetricValue(row.successful)}</td>
                  <td>{formatMetricValue(row.throughputScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pod-legend">
          {[
            { color: "#2d5a3d", label: "Beats written" },
            { color: "#c2703e", label: "Scripts produced" },
            { color: "#2d5a3d", label: "Successful scripts" },
          ].map((item) => (
            <div key={item.label} className="pod-legend-item">
              <span className="pod-legend-swatch" style={{ background: item.color }} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </ShareablePanel>
  );
}
