import PodLeadScriptChangesView from "./PodLeadScriptChangesView.jsx";
import { getPodLeadScriptChangesReport } from "../../lib/pod-lead-script-changes.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "POD Lead Script Changes",
  description: "Median POD-lead edits per script before Live-tab arrival.",
};

export default async function PodLeadScriptChangesPage() {
  try {
    const report = await getPodLeadScriptChangesReport();
    return <PodLeadScriptChangesView initialReport={report} />;
  } catch (error) {
    return <PodLeadScriptChangesView initialError={error.message || "Unable to load this page right now."} />;
  }
}
