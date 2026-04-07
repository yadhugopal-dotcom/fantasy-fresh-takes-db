import TimelineBackButton from "./TimelineBackButton.jsx";
import {
  fetchEditorialTabRows,
  fetchIdeationTabRows,
  fetchLiveTabRows,
  fetchProductionTabRows,
  normalizePodLeadName,
  parseLiveDate,
} from "../../lib/live-tab.js";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function formatDateLabel(value) {
  if (!value) return "-";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatShortDateLabel(value) {
  if (!value) return "-";
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function daysBetween(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Math.round(diffMs / 86_400_000);
}

function findLiveRow(rows, params) {
  const requestedRowIndex = Number(params.liveRowIndex || 0);
  const requestedAdCode = normalizeKey(params.adCode);
  const requestedShow = normalizeKey(params.show);
  const requestedAngle = normalizeKey(params.angle);
  const requestedPod = normalizeKey(params.pod);
  const requestedLiveDate = String(params.liveDate || "").trim();

  return (
    rows.find((row) => Number(row?.rowIndex || 0) === requestedRowIndex) ||
    rows.find((row) => {
      const rowAdCode = normalizeKey(row?.assetCode || row?.baseAssetCode || "");
      return (
        rowAdCode === requestedAdCode &&
        normalizeKey(row?.showName) === requestedShow &&
        normalizeKey(row?.beatName) === requestedAngle &&
        normalizeKey(row?.podLeadName) === requestedPod &&
        String(row?.liveDate || "") === requestedLiveDate
      );
    }) ||
    rows.find((row) => {
      const rowAdCode = normalizeKey(row?.assetCode || row?.baseAssetCode || "");
      return rowAdCode && rowAdCode === requestedAdCode;
    }) ||
    null
  );
}

function findIdeationRow(rows, liveRow, params) {
  const showKey = normalizeKey(liveRow?.showName || params.show);
  const beatKey = normalizeKey(liveRow?.beatName || params.angle);
  const podKey = normalizeKey(liveRow?.podLeadName || params.pod);

  return (
    rows.find(
      (row) =>
        normalizeKey(row?.showName) === showKey &&
        normalizeKey(row?.beatName) === beatKey &&
        normalizeKey(normalizePodLeadName(row?.podLeadName || "")) === podKey
    ) || null
  );
}

function getMatchingRows(rows, liveRow, params, type) {
  const showKey = normalizeKey(liveRow?.showName || params.show);
  const beatKey = normalizeKey(liveRow?.beatName || params.angle);
  const podKey = normalizeKey(liveRow?.podLeadName || params.pod);
  const adCodeKey = normalizeKey(liveRow?.assetCode || liveRow?.baseAssetCode || params.adCode);

  return rows.filter((row) => {
    const rowAdCode = normalizeKey(row?.assetCode || "");
    if (rowAdCode && adCodeKey && rowAdCode === adCodeKey) {
      return true;
    }

    return (
      normalizeKey(row?.showName) === showKey &&
      normalizeKey(row?.beatName) === beatKey &&
      normalizeKey(normalizePodLeadName(row?.podLeadName || "")) === podKey
    );
  }).sort((left, right) => {
    const leftDate = String(left?.submittedDate || left?.productionPickedDate || "");
    const rightDate = String(right?.submittedDate || right?.productionPickedDate || "");
    return rightDate.localeCompare(leftDate) || Number(right?.rowIndex || 0) - Number(left?.rowIndex || 0);
  });
}

function StageCard({
  step,
  title,
  tone,
  summary,
  startDate,
  midDate,
  endDate,
  footer,
  lines = [],
}) {
  const totalDays = daysBetween(startDate, endDate);
  const firstSegment = startDate && midDate && endDate ? Math.max(daysBetween(startDate, midDate) || 0, 0) : null;
  const secondSegment = startDate && endDate && firstSegment !== null ? Math.max((totalDays || 0) - firstSegment, 0) : null;
  const firstWidth = totalDays && firstSegment !== null ? Math.max((firstSegment / totalDays) * 100, 18) : 100;
  const secondWidth = totalDays && secondSegment !== null ? Math.max(100 - firstWidth, 12) : 0;

  return (
    <section
      style={{
        padding: 22,
        borderRadius: 24,
        background: "rgba(18, 19, 24, 0.94)",
        border: `1px solid ${tone.frame}`,
        boxShadow: "0 20px 40px rgba(0, 0, 0, 0.18)",
        color: "#f8f7f2",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: tone.badge,
            color: tone.badgeText,
            fontSize: 14,
            fontWeight: 800,
          }}
        >
          {step}
        </span>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: tone.title }}>{title}</div>
          <div style={{ marginTop: 2, color: "#c7c4bc", fontSize: 14 }}>{summary}</div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          overflow: "hidden",
          height: 16,
          borderRadius: 999,
          background: "rgba(255,255,255,0.08)",
          marginBottom: 12,
        }}
      >
        <div style={{ width: `${firstWidth}%`, background: tone.primary }} />
        {secondWidth > 0 ? <div style={{ width: `${secondWidth}%`, background: tone.secondary }} /> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: tone.primary }}>{formatShortDateLabel(startDate)}</div>
          <div style={{ fontSize: 12, color: "#9f9b93", marginTop: 4 }}>Start</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#efe6d6" }}>{formatShortDateLabel(midDate)}</div>
          <div style={{ fontSize: 12, color: "#9f9b93", marginTop: 4 }}>Checkpoint</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: tone.secondary }}>{formatShortDateLabel(endDate)}</div>
          <div style={{ fontSize: 12, color: "#9f9b93", marginTop: 4 }}>End</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {lines.map((line) => (
          <div key={line.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#d9d5cb", fontSize: 14 }}>
            <span style={{ color: "#a8a39a" }}>{line.label}</span>
            <span style={{ textAlign: "right", fontWeight: 600 }}>{line.value || "-"}</span>
          </div>
        ))}
      </div>

      {footer ? <div style={{ marginTop: 16, color: tone.title, fontSize: 14, fontWeight: 700 }}>{footer}</div> : null}
    </section>
  );
}

function ProductionLane({ label, startDate, endDate, tone }) {
  const totalDays = daysBetween(startDate, endDate);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr auto", alignItems: "center", gap: 14 }}>
      <div style={{ color: "#dbd8cf", fontSize: 14 }}>{label}</div>
      <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.08)" }}>
        <div style={{ width: "100%", background: tone }} />
      </div>
      <div style={{ color: "#f5f0e5", fontWeight: 700, fontSize: 13 }}>{totalDays == null ? "-" : `${totalDays} d`}</div>
    </div>
  );
}

export default async function TimelinePage({ searchParams }) {
  const params = (await searchParams) || {};
  const returnTo = String(params?.returnTo || "/#live-sheet-data");

  const [{ rows: liveRows }, { rows: editorialRows }, { rows: productionRows }, { rows: ideationRows }] = await Promise.all([
    fetchLiveTabRows(),
    fetchEditorialTabRows(),
    fetchProductionTabRows(),
    fetchIdeationTabRows(),
  ]);

  const liveRow = findLiveRow(liveRows, params);
  const ideationRow = findIdeationRow(ideationRows, liveRow, params);
  const matchedEditorialRows = getMatchingRows(editorialRows, liveRow, params, "editorial");
  const matchedProductionRows = getMatchingRows(productionRows, liveRow, params, "production");
  const latestEditorialRow = matchedEditorialRows[0] || null;
  const latestProductionRow = matchedProductionRows[0] || null;

  const beatAssignedDate = parseLiveDate(ideationRow?.assignedDate || ideationRow?.beatsAssignedDate || "");
  const beatCompletedDate = parseLiveDate(ideationRow?.completedDate || ideationRow?.beatsAssignedDate || "");
  const editorialLeadDate = parseLiveDate(latestEditorialRow?.submittedDate || "");
  const productionStartDate = parseLiveDate(latestProductionRow?.productionPickedDate || liveRow?.tatStartDate || "");
  const liveStartDate = parseLiveDate(liveRow?.tatStartDate || latestProductionRow?.productionPickedDate || "");
  const liveEndDate = parseLiveDate(liveRow?.liveDate || "");
  const totalPipelineDays = daysBetween(beatAssignedDate || editorialLeadDate || productionStartDate || liveStartDate, liveEndDate);

  const productionLanes = [
    { label: "VO", startDate: productionStartDate, endDate: liveEndDate, tone: "#55c08a" },
    { label: "Sound", startDate: productionStartDate, endDate: liveEndDate, tone: "#f26a5d" },
    { label: "SRT", startDate: productionStartDate, endDate: liveEndDate, tone: "#55c08a" },
    { label: "ACD", startDate: productionStartDate, endDate: liveEndDate, tone: "#f26a5d" },
    { label: "Editor", startDate: productionStartDate, endDate: liveEndDate, tone: "#f5ae55" },
  ];

  const statusChips = [
    latestEditorialRow?.status ? { label: "Editorial", value: latestEditorialRow.status } : null,
    latestProductionRow?.status ? { label: "Production", value: latestProductionRow.status } : null,
    ideationRow?.beatsStatus || ideationRow?.status ? { label: "Beat", value: ideationRow?.beatsStatus || ideationRow?.status } : null,
  ].filter(Boolean);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 20px 64px",
        background: "radial-gradient(circle at top left, #2c2f38 0%, #17181d 52%, #101014 100%)",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#b7b3aa" }}>
              Asset Timeline
            </div>
            <h1 style={{ margin: 0, fontSize: 42, lineHeight: 1.02, color: "#faf6ee" }}>
              {liveRow?.assetCode || liveRow?.baseAssetCode || normalizeText(params?.adCode) || "Selected asset"}
            </h1>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {[
                ["Show", liveRow?.showName || normalizeText(params?.show) || "-"],
                ["Angle", liveRow?.beatName || normalizeText(params?.angle) || "-"],
                ["POD", liveRow?.podLeadName || normalizeText(params?.pod) || "-"],
                ["Final upload", formatDateLabel(liveEndDate)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#f5efe4",
                  }}
                >
                  <span style={{ color: "#aaa59a", marginRight: 8 }}>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </div>

          <TimelineBackButton fallbackHref={returnTo} />
        </div>

        {!liveRow ? (
          <section
            style={{
              padding: 24,
              borderRadius: 24,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#f5efe4",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Timeline not found for this asset</div>
            <div style={{ color: "#c4beb2", lineHeight: 1.7 }}>
              The selected Live-sheet row could not be matched exactly. The dashboard link now sends a stronger row identity, so reopening the
              asset from the dashboard should work after refresh.
            </div>
          </section>
        ) : (
          <>
            <section
              style={{
                padding: 20,
                borderRadius: 24,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                display: "grid",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ color: "#f5efe4", fontSize: 22, fontWeight: 800 }}>Overall picture</div>
                  <div style={{ color: "#b7b3aa", marginTop: 4 }}>
                    This timeline is built from the selected Live row plus matching Ideation, Editorial, and Production rows.
                  </div>
                </div>
                <div style={{ color: "#8fe0af", fontWeight: 800, fontSize: 20 }}>
                  {totalPipelineDays == null ? "Timeline still partial" : `${totalPipelineDays} days end to end`}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {statusChips.map((chip) => (
                  <div
                    key={chip.label}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.08)",
                      color: "#f5efe4",
                      fontWeight: 700,
                    }}
                  >
                    {chip.label}: {chip.value}
                  </div>
                ))}
              </div>
            </section>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
              <StageCard
                step="1"
                title="Beat"
                tone={{ frame: "#7a6cff", badge: "#ece8ff", badgeText: "#5c4fd7", title: "#8f84ff", primary: "#57c898", secondary: "#f26658" }}
                summary="Ideation sheet milestone"
                startDate={beatAssignedDate}
                midDate={beatCompletedDate || beatAssignedDate}
                endDate={beatCompletedDate || beatAssignedDate}
                footer={daysBetween(beatAssignedDate, beatCompletedDate) == null ? "" : `${daysBetween(beatAssignedDate, beatCompletedDate)} days in beats`}
                lines={[
                  { label: "Beat name", value: ideationRow?.beatName || liveRow?.beatName || "-" },
                  { label: "Status", value: ideationRow?.beatsStatus || ideationRow?.status || "-" },
                  { label: "Assigned", value: formatDateLabel(beatAssignedDate) },
                ]}
              />

              <StageCard
                step="2"
                title="Editorial"
                tone={{ frame: "#42b48e", badge: "#dbfff2", badgeText: "#20775c", title: "#69d3ae", primary: "#57c898", secondary: "#f26658" }}
                summary="Lead submit milestone"
                startDate={beatCompletedDate || beatAssignedDate}
                midDate={editorialLeadDate}
                endDate={editorialLeadDate}
                lines={[
                  { label: "Status", value: latestEditorialRow?.status || "-" },
                  { label: "Writer", value: latestEditorialRow?.writerName || liveRow?.writerName || "-" },
                  { label: "Lead submitted", value: formatDateLabel(editorialLeadDate) },
                ]}
              />

              <StageCard
                step="3"
                title="Ready for prod"
                tone={{ frame: "#d18d2f", badge: "#fff0d2", badgeText: "#8e5d00", title: "#efab48", primary: "#57c898", secondary: "#57c898" }}
                summary="Editorial to production handoff"
                startDate={editorialLeadDate}
                midDate={productionStartDate}
                endDate={productionStartDate}
                lines={[
                  { label: "Lead submitted", value: formatDateLabel(editorialLeadDate) },
                  { label: "ETA to start prod", value: formatDateLabel(productionStartDate) },
                  { label: "Gap", value: daysBetween(editorialLeadDate, productionStartDate) == null ? "-" : `${daysBetween(editorialLeadDate, productionStartDate)} d` },
                ]}
              />
            </div>

            <section
              style={{
                padding: 24,
                borderRadius: 24,
                background: "rgba(18, 19, 24, 0.94)",
                border: "1px solid #dd7b3b",
                boxShadow: "0 20px 40px rgba(0, 0, 0, 0.18)",
                display: "grid",
                gap: 18,
              }}
            >
              <div>
                <div style={{ color: "#f08e4f", fontSize: 28, fontWeight: 800 }}>4 Production</div>
                <div style={{ color: "#c8c3ba", marginTop: 4 }}>Parallel team view using the asset&apos;s production start and final upload dates.</div>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                {productionLanes.map((lane) => (
                  <ProductionLane key={lane.label} {...lane} />
                ))}
              </div>

              <div style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#57c898" }}>{formatShortDateLabel(productionStartDate)}</div>
                  <div style={{ color: "#98948a", fontSize: 12, marginTop: 4 }}>ETA start</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#e7e1d4" }}>{latestProductionRow?.status || "-"}</div>
                  <div style={{ color: "#98948a", fontSize: 12, marginTop: 4 }}>Production status</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#f26658" }}>{formatShortDateLabel(liveEndDate)}</div>
                  <div style={{ color: "#98948a", fontSize: 12, marginTop: 4 }}>Final delivery</div>
                </div>
              </div>
            </section>

            <StageCard
              step="5"
              title="Live"
              tone={{ frame: "#d7f6e9", badge: "#1c5740", badgeText: "#ebfff6", title: "#daf6e8", primary: "#2f7f66", secondary: "#2f7f66" }}
              summary="Published asset milestone"
              startDate={liveStartDate}
              midDate={liveEndDate}
              endDate={liveEndDate}
              footer={totalPipelineDays == null ? "" : `Published in ${totalPipelineDays} days total`}
              lines={[
                { label: "AD code", value: liveRow.assetCode || liveRow.baseAssetCode || "-" },
                { label: "Production start", value: formatDateLabel(liveStartDate) },
                { label: "Final upload", value: formatDateLabel(liveEndDate) },
              ]}
            />

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <TimelineBackButton fallbackHref={returnTo} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
