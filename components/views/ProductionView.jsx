"use client";

import { useMemo, useState } from "react";
import {
  AcdLeaderboardChart,
  EmptyState,
  ShareablePanel,
  ToggleGroup,
  ACD_TIME_OPTIONS,
  ACD_VIEW_OPTIONS,
  formatNumber,
  formatDateLabel,
  formatDateTimeLabel,
  getAcdViewLabel,
  getAcdLeaderboardDataset,
} from "./shared.jsx";

// ─── Private helpers ──────────────────────────────────────────────────────────

const EMPTY_ACD_MESSAGE = "No valid ACD output data available yet from Live tab sync.";
const ASSET_TYPE_OPTIONS = ["GA", "GI", "GU"];

function detectAssetType(assetCode) {
  const normalized = String(assetCode || "").trim().toUpperCase();
  if (normalized.startsWith("GA")) return "GA";
  if (normalized.startsWith("GI")) return "GI";
  if (normalized.startsWith("GU")) return "GU";
  return "OTHER";
}

function buildAcdSyncMeta(syncStatus) {
  const latest = syncStatus?.latestRun;
  if (!latest?.createdAt) {
    return "No ACD sync runs found yet. Daily cron will populate this.";
  }

  return `Last ACD sync: ${formatDateTimeLabel(latest.createdAt)} | Live rows: ${formatNumber(
    latest.processedLiveRows
  )} | Eligible: ${formatNumber(latest.eligibleLiveRows)} | Sheets attempted: ${formatNumber(
    latest.sheetLinksAttempted
  )} | Failed: ${formatNumber(latest.sheetLinksFailed)}`;
}

function buildAcdAdherenceMeta(syncStatus) {
  const cutoffDate = syncStatus?.cutoffDate ? formatDateLabel(syncStatus.cutoffDate) : "2026-03-16";
  const totalFailedSheets = Number(syncStatus?.totalFailedSheets || 0);
  const rows = Array.isArray(syncStatus?.adherenceIssueRows) ? syncStatus.adherenceIssueRows : [];

  if (!rows.length) {
    return `Unread or invalid image sheets since ${cutoffDate}. No adherence failures logged.`;
  }

  return `Unread or invalid image sheets since ${cutoffDate}. Failed sheets logged: ${formatNumber(
    totalFailedSheets
  )}. Grouped by CD and ACD.`;
}

function formatFailureReasonLabel(reason) {
  const key = String(reason || "")
    .split(":")[0]
    .trim()
    .toLowerCase();

  if (key === "sheet_inaccessible") return "Sheet inaccessible";
  if (key === "missing_final_image_sheet_tab") return "Missing Final image sheet tab";
  if (key === "required_columns_missing") return "Required columns missing";
  if (key === "work_date_parse_failure") return "Work date parse failure";
  if (key === "no_valid_rows_found") return "No valid rows found";
  if (key === "invalid_creative_director") return "Invalid creative director";
  if (key === "missing_asset_code") return "Missing asset code";
  if (!key) return "Other format issue";

  return key
    .split("_")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ""))
    .join(" ");
}


function AcdAdherenceTable({ rows }) {
  const safeRows = Array.isArray(rows) ? rows : [];

  return (
    <div className="table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>CD</th>
            <th>ACD</th>
            <th>Total Assets Not Adhering</th>
            <th>Asset Codes</th>
          </tr>
        </thead>
        <tbody>
          {safeRows.length > 0 ? (
            safeRows.map((row) => {
              const totalAssets = Number(row.totalAssetsNotAdhering || 0);
              const severityClass =
                totalAssets >= 3 ? "adherence-row-high" : totalAssets === 2 ? "adherence-row-medium" : "adherence-row-low";
              const severityLabel = totalAssets >= 3 ? "High" : totalAssets === 2 ? "Medium" : "Low";

              return (
                <tr key={`${row.cdName}-${row.acdName}`} className={severityClass}>
                  <td>{row.cdName || "Unknown"}</td>
                  <td>{row.acdName || "Unknown ACD"}</td>
                  <td>
                    <div className="adherence-count-cell">
                      <span className={`severity-pill ${severityClass}`}>{severityLabel}</span>
                      <strong>{formatNumber(totalAssets)}</strong>
                    </div>
                  </td>
                  <td>
                    <div className="adherence-asset-list">
                      {(Array.isArray(row.assets) ? row.assets : []).length > 0
                        ? row.assets.map((asset) => {
                            const label = asset.assetCode || "-";
                            const href = String(asset.imageSheetLink || "").trim();
                            return href ? (
                              <a
                                key={`${row.cdName}-${row.acdName}-${label}`}
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="adherence-asset-link"
                              >
                                {label}
                              </a>
                            ) : (
                              <span key={`${row.cdName}-${row.acdName}-${label}`}>{label}</span>
                            );
                          })
                        : "-"}
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan="4" className="empty-cell">
                No adherence issues found for the selected sync window.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function ProductionContent({
  acdMetricsData,
  acdMetricsLoading,
  acdMetricsError,
  acdTimeView,
  onTimeViewChange,
  acdViewType,
  onViewTypeChange,
  onRunSync,
  busyAction,
  onShare,
  copyingSection,
}) {
  const [selectedAssetTypes, setSelectedAssetTypes] = useState(ASSET_TYPE_OPTIONS);
  const safeAcdMetricsData =
    acdMetricsData ||
    {
      syncStatus: {},
      latestWorkDate: "",
      failureReasonRows: [],
      emptyStateMessage: EMPTY_ACD_MESSAGE,
      acdDailyRows: [],
      acdWeeklyRows: [],
      acdCdRows: [],
      acdCdWeeklyRows: [],
    };

  const syncStatus = safeAcdMetricsData.syncStatus || {};
  const dataset = getAcdLeaderboardDataset(safeAcdMetricsData, acdTimeView, acdViewType);
  const viewLabel = getAcdViewLabel(dataset.viewType);
  const notes = [syncStatus.syncError, syncStatus.sourceFilterWarning].filter(Boolean);
  const latestWorkDateLabel = safeAcdMetricsData.latestWorkDate ? formatDateLabel(safeAcdMetricsData.latestWorkDate) : "";
  const adherenceIssueRows = Array.isArray(syncStatus.adherenceIssueRows) ? syncStatus.adherenceIssueRows : [];
  const failureReasonRows = Array.isArray(safeAcdMetricsData.failureReasonRows) ? safeAcdMetricsData.failureReasonRows : [];
  const totalFailedSheets = Number(syncStatus.totalFailedSheets || 0);
  const totalCdsAffected = Array.isArray(syncStatus.adherenceRows) ? syncStatus.adherenceRows.length : 0;
  const filteredAdherenceIssueRows = useMemo(() => {
    const selected = new Set(selectedAssetTypes);
    return adherenceIssueRows
      .map((row) => {
        const filteredAssets = (Array.isArray(row.assets) ? row.assets : []).filter((asset) =>
          selected.has(detectAssetType(asset?.assetCode))
        );
        return {
          ...row,
          assets: filteredAssets,
          totalAssetsNotAdhering: filteredAssets.length,
        };
      })
      .filter((row) => Number(row.totalAssetsNotAdhering || 0) > 0);
  }, [adherenceIssueRows, selectedAssetTypes]);
  const filteredTotalAssets = filteredAdherenceIssueRows.reduce(
    (sum, row) => sum + Number(row.totalAssetsNotAdhering || 0),
    0
  );
  const filteredCdsAffected = new Set(filteredAdherenceIssueRows.map((row) => row.cdName || "")).size;

  return (
    <div className="section-stack">
      {acdMetricsLoading ? <div className="warning-note">Loading data. Showing placeholder values.</div> : null}
      {acdMetricsError ? <div className="warning-note">{acdMetricsError}</div> : null}
      {notes.map((note) => (
        <div key={note} className="warning-note">
          {note}
        </div>
      ))}

      <ShareablePanel
        shareLabel="Production ACD sync"
        onShare={onShare}
        isSharing={copyingSection === "Production ACD sync"}
      >
        <div className="panel-head panel-head-tight">
          <div>
            <div className="panel-title">ACD Daily Sync</div>
            <div className="panel-statline">{buildAcdSyncMeta(syncStatus)}</div>
          </div>
        </div>
        <div className="panel-stack">
          <div className="section-actions section-actions-left" data-share-ignore="true">
            <button
              type="button"
              className="primary-button"
              onClick={() => void onRunSync()}
              disabled={busyAction !== ""}
            >
              {busyAction === "acd-sync" ? "Running sync..." : "Run sync"}
            </button>
          </div>
        </div>
      </ShareablePanel>

      <ShareablePanel
        shareLabel="Production ACD chart"
        onShare={onShare}
        isSharing={copyingSection === "Production ACD chart"}
      >
        <div className="panel-head">
          <div>
            <div className="panel-title">{viewLabel} productivity chart</div>
            <div className="panel-statline">
              <span>{dataset.rows.length > 0 ? dataset.meta : safeAcdMetricsData.emptyStateMessage || EMPTY_ACD_MESSAGE}</span>
              {latestWorkDateLabel ? <span>Latest synced work date: {latestWorkDateLabel}</span> : null}
            </div>
          </div>
          <div className="production-toggle-wrap" data-share-ignore="true">
            <ToggleGroup
              label="Time View"
              options={ACD_TIME_OPTIONS}
              value={acdTimeView}
              onChange={onTimeViewChange}
              disabled={busyAction !== ""}
            />
            <ToggleGroup
              label="View Type"
              options={ACD_VIEW_OPTIONS}
              value={acdViewType}
              onChange={onViewTypeChange}
              disabled={busyAction !== ""}
            />
          </div>
        </div>
        <AcdLeaderboardChart rows={dataset.rows} viewLabel={viewLabel} emptyText={EMPTY_ACD_MESSAGE} />
      </ShareablePanel>

      <ShareablePanel
        shareLabel="Production troubleshooting"
        onShare={onShare}
        isSharing={copyingSection === "Production troubleshooting"}
        className="production-troubleshooting-panel"
      >
        <div className="panel-head panel-head-tight">
          <div>
            <div className="panel-title">ACD Sync Rules and Adherence Issues</div>
            <div className="panel-statline">{buildAcdAdherenceMeta(syncStatus)}</div>
          </div>
        </div>
        <div className="rules-card">
          <div className="rules-card-title">Image sheet rules for ACD sync</div>
          <ol className="rules-list">
            <li>Please ensure sheet is accessible to everyone (outside PocketFM also).</li>
            <li>
              Please ensure that ACD name is tagged as google chips against every image &amp; the column is named as
              &quot;ACD Name&quot;.
            </li>
            <li>
              Please ensure that Work date is tagged against every image &amp; the column is named as
              &quot;Work Date&quot;.
            </li>
            <li>
              Please ensure that the final image links are named under the column &quot;Final Image URL&quot;.
            </li>
            <li>Please name the tab with all images as &quot;Final image sheet&quot;.</li>
          </ol>
        </div>

        <div className="troubleshoot-summary-grid">
          <div className="troubleshoot-summary-card">
            <span>Filtered non-adhering assets</span>
            <strong>{formatNumber(filteredTotalAssets || totalFailedSheets)}</strong>
          </div>
          <div className="troubleshoot-summary-card">
            <span>Filtered CDs affected</span>
            <strong>{formatNumber(filteredCdsAffected || totalCdsAffected)}</strong>
          </div>
        </div>

        <div className="panel-stack" data-share-ignore="true">
          <div className="panel-title panel-title-xs">Asset Type Filter</div>
          <div className="production-asset-filter-row">
            {ASSET_TYPE_OPTIONS.map((type) => {
              const isActive = selectedAssetTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  className={isActive ? "toggle-chip is-active" : "toggle-chip"}
                  onClick={() =>
                    setSelectedAssetTypes((current) => {
                      if (current.includes(type)) {
                        const next = current.filter((item) => item !== type);
                        return next.length > 0 ? next : current;
                      }
                      return [...current, type];
                    })
                  }
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>

        {failureReasonRows.length > 0 ? (
          <div className="failure-reason-row">
            {failureReasonRows.map((row) => (
              <div key={row.failureReason} className="failure-reason-pill">
                <span>{formatFailureReasonLabel(row.failureReason)}</span>
                <strong>{formatNumber(row.count)}</strong>
              </div>
            ))}
          </div>
        ) : null}

        <div>
          <div className="panel-title">Image Sheet Adherence Issues</div>
          <AcdAdherenceTable rows={filteredAdherenceIssueRows} />
        </div>
      </ShareablePanel>
    </div>
  );
}
