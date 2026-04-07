"use client";

import { useEffect, useMemo, useState } from "react";

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${formatNumber(value)}%`;
}

function getPerformanceTone(beatsPerWriter) {
  if (beatsPerWriter >= 18) return { label: "High output", color: "#2d5a3d", bg: "rgba(45, 90, 61, 0.12)" };
  if (beatsPerWriter >= 10) return { label: "Steady", color: "#9a6a2f", bg: "rgba(194, 112, 62, 0.12)" };
  return { label: "Needs support", color: "#9f2e2e", bg: "rgba(159, 46, 46, 0.12)" };
}

export default function BeatsPerformancePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/dashboard/competition", { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load beats performance.");
        }

        if (!cancelled) {
          setData(payload);
        }
      } catch (nextError) {
        if (!cancelled) {
          setData(null);
          setError(nextError.message || "Unable to load beats performance.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  const rankedPods = useMemo(() => {
    const rows = Array.isArray(data?.podRows) ? data.podRows : [];
    return [...rows]
      .map((row) => {
        const beats = Number(row?.lifetimeBeats || 0);
        const writerCount = Number(row?.writerCount || 0);
        const successful = Number(row?.hitRateNumerator || 0);
        const scripts = Number(row?.lifetimeScripts || 0);
        const beatsPerWriter = writerCount > 0 ? Number((beats / writerCount).toFixed(1)) : 0;
        const successRate = scripts > 0 ? Number(((successful / scripts) * 100).toFixed(1)) : null;

        return {
          podLeadName: row?.podLeadName || "Unknown POD",
          beats,
          writerCount,
          successful,
          scripts,
          beatsPerWriter,
          successRate,
        };
      })
      .sort((left, right) => {
        if (right.beats !== left.beats) return right.beats - left.beats;
        if (right.beatsPerWriter !== left.beatsPerWriter) return right.beatsPerWriter - left.beatsPerWriter;
        return left.podLeadName.localeCompare(right.podLeadName);
      });
  }, [data]);

  const summary = useMemo(() => {
    const totalBeats = rankedPods.reduce((sum, row) => sum + row.beats, 0);
    const totalWriters = rankedPods.reduce((sum, row) => sum + row.writerCount, 0);
    const avgBeatsPerWriter = totalWriters > 0 ? Number((totalBeats / totalWriters).toFixed(1)) : 0;
    const topPod = rankedPods[0] || null;

    return {
      totalBeats,
      totalWriters,
      avgBeatsPerWriter,
      topPod,
    };
  }, [rankedPods]);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "40px 20px 64px",
        background:
          "radial-gradient(circle at top left, rgba(194,112,62,0.14), transparent 28%), linear-gradient(180deg, #f7f2e8 0%, #efe6d8 100%)",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div
          style={{
            borderRadius: 28,
            padding: "28px 28px 24px",
            background: "rgba(255,255,255,0.86)",
            border: "1px solid rgba(34,30,26,0.08)",
            boxShadow: "0 24px 70px rgba(56, 40, 18, 0.08)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#8a6741" }}>
            Fresh Take Dashboard
          </div>
          <h1 style={{ margin: "10px 0 8px", fontSize: "clamp(2rem, 4vw, 3.4rem)", lineHeight: 1.02, color: "#1f1b16" }}>
            Beats Performance
          </h1>
          <p style={{ margin: 0, maxWidth: 760, fontSize: 16, lineHeight: 1.6, color: "#5e5548" }}>
            A focused view of POD-wise beat output using the same live competition data already connected in the app.
          </p>
        </div>

        {loading ? (
          <div style={{ marginTop: 24, padding: 28, borderRadius: 24, background: "rgba(255,255,255,0.82)" }}>Loading beats performance...</div>
        ) : null}

        {error ? (
          <div
            style={{
              marginTop: 24,
              padding: 20,
              borderRadius: 20,
              background: "rgba(159, 46, 46, 0.12)",
              border: "1px solid rgba(159, 46, 46, 0.2)",
              color: "#7f2323",
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        ) : null}

        {!loading && !error ? (
          <>
            <section
              style={{
                marginTop: 24,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 16,
              }}
            >
              {[
                { label: "Total beats", value: formatNumber(summary.totalBeats), hint: "Lifetime beats across visible PODs" },
                { label: "Writers mapped", value: formatNumber(summary.totalWriters), hint: "Current active writers in roster" },
                { label: "Avg beats per writer", value: formatNumber(summary.avgBeatsPerWriter), hint: "Total beats divided by writer count" },
                {
                  label: "Top POD",
                  value: summary.topPod?.podLeadName || "-",
                  hint: summary.topPod ? `${formatNumber(summary.topPod.beats)} beats` : "No POD data yet",
                },
              ].map((card) => (
                <div
                  key={card.label}
                  style={{
                    padding: 20,
                    borderRadius: 22,
                    background: "rgba(255,255,255,0.82)",
                    border: "1px solid rgba(34,30,26,0.08)",
                    boxShadow: "0 16px 40px rgba(56, 40, 18, 0.06)",
                  }}
                >
                  <div style={{ fontSize: 13, color: "#776b5b", marginBottom: 8 }}>{card.label}</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: "#1f1b16", lineHeight: 1.1 }}>{card.value}</div>
                  <div style={{ marginTop: 8, fontSize: 12, color: "#8a806f" }}>{card.hint}</div>
                </div>
              ))}
            </section>

            <section
              style={{
                marginTop: 24,
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.4fr) minmax(300px, 0.8fr)",
                gap: 20,
              }}
            >
              <div
                style={{
                  borderRadius: 24,
                  padding: 22,
                  background: "rgba(255,255,255,0.84)",
                  border: "1px solid rgba(34,30,26,0.08)",
                  overflowX: "auto",
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 800, color: "#1f1b16", marginBottom: 6 }}>POD leaderboard</div>
                <div style={{ fontSize: 14, color: "#746957", marginBottom: 18 }}>
                  Ranked by total beats, with output efficiency and script success context.
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#6f6455", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      <th style={{ padding: "0 0 12px" }}>POD</th>
                      <th style={{ padding: "0 0 12px" }}>Beats</th>
                      <th style={{ padding: "0 0 12px" }}>Writers</th>
                      <th style={{ padding: "0 0 12px" }}>Beats / writer</th>
                      <th style={{ padding: "0 0 12px" }}>Successful scripts</th>
                      <th style={{ padding: "0 0 12px" }}>Script hit rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedPods.map((row) => {
                      const tone = getPerformanceTone(row.beatsPerWriter);
                      return (
                        <tr key={row.podLeadName} style={{ borderTop: "1px solid rgba(34,30,26,0.08)" }}>
                          <td style={{ padding: "16px 0", fontWeight: 700, color: "#1f1b16" }}>{row.podLeadName}</td>
                          <td style={{ padding: "16px 0", color: "#3d352b" }}>{formatNumber(row.beats)}</td>
                          <td style={{ padding: "16px 0", color: "#3d352b" }}>{formatNumber(row.writerCount)}</td>
                          <td style={{ padding: "16px 0" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "8px 12px",
                                borderRadius: 999,
                                background: tone.bg,
                                color: tone.color,
                                fontWeight: 700,
                              }}
                            >
                              {formatNumber(row.beatsPerWriter)}
                            </span>
                          </td>
                          <td style={{ padding: "16px 0", color: "#3d352b" }}>{formatNumber(row.successful)}</td>
                          <td style={{ padding: "16px 0", color: "#3d352b" }}>{formatPercent(row.successRate)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "grid", gap: 20 }}>
                {rankedPods.slice(0, 3).map((row, index) => {
                  const tone = getPerformanceTone(row.beatsPerWriter);
                  return (
                    <div
                      key={row.podLeadName}
                      style={{
                        borderRadius: 24,
                        padding: 22,
                        background: index === 0 ? "#1f1b16" : "rgba(255,255,255,0.84)",
                        color: index === 0 ? "#f8f1e7" : "#1f1b16",
                        border: "1px solid rgba(34,30,26,0.08)",
                        boxShadow: "0 16px 34px rgba(56, 40, 18, 0.08)",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.78 }}>
                        #{index + 1} ranked POD
                      </div>
                      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 800 }}>{row.podLeadName}</div>
                      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 12, opacity: 0.72 }}>Total beats</div>
                          <div style={{ fontSize: 24, fontWeight: 800 }}>{formatNumber(row.beats)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 12, opacity: 0.72 }}>Beats / writer</div>
                          <div style={{ fontSize: 24, fontWeight: 800 }}>{formatNumber(row.beatsPerWriter)}</div>
                        </div>
                      </div>
                      <div
                        style={{
                          marginTop: 18,
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "8px 12px",
                          borderRadius: 999,
                          background: index === 0 ? "rgba(248,241,231,0.12)" : tone.bg,
                          color: index === 0 ? "#f8d7ae" : tone.color,
                          fontWeight: 700,
                        }}
                      >
                        {tone.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
