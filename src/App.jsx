import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { findStation, stations } from "./data.js";
import { Shell } from "./ui.jsx";
import {
  AboutPage,
  ActivityPage,
  AgentsPage,
  AvailabilityPage,
  DisclaimerPage,
  HelpPage,
  HomePage,
  ListPage,
  ModelListPage,
  ModelPage,
  AccountPage,
  PointsPage,
  PrivacyPage,
  ReputationPage,
  ReportPage,
  StationPage,
  SubmissionsPage,
  TermsPage,
} from "./pages.jsx";
import { BasicRunPage, RunKeeper } from "./basic-run.jsx";
import { DetectRunPage } from "./detect-page.jsx";
import { CodexPage, HistoryPage, IqPage, SpeedPage } from "./tools.jsx";
import { ApplyPage, CheckPage, OfficialPage } from "./verd-pages.jsx";
import { ProposalsPage } from "./proposals.jsx";

function LegacyStationRedirect() {
  const { slug } = useParams();
  const station = findStation(slug);
  return <Navigate to={station?.path || `/site/${slug}`} replace />;
}

function storedScore(id) {
  const key = String(id || "");
  if (!key) return false;
  return stations.some((station) => (station.tests || []).some((test) => test.id === key && test.suite !== "basic"));
}

function StoredRunPage() {
  const { id } = useParams();
  const text = String(id || "");
  if (storedScore(text)) return <ReportPage />;
  if (text.startsWith("basic-") || text.startsWith("all-") || text.startsWith("candy-") || text.startsWith("pelican-")) return <BasicRunPage />;
  return <ReportPage />;
}

function LegacyDetectRedirect() {
  const { id } = useParams();
  if (storedScore(id)) return <Navigate to={`/b/${id}`} replace />;
  return <DetectRunPage />;
}

function LegacyReportRedirect() {
  const { id } = useParams();
  return <Navigate to={`/b/${id || ""}`} replace />;
}

export default function App() {
  return (
    <Shell>
      <RunKeeper />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/list" element={<ListPage />} />
        <Route path="/cat/:cat" element={<ListPage />} />
        <Route path="/site/:token" element={<StationPage />} />
        <Route path="/station/:slug" element={<LegacyStationRedirect />} />
        <Route path="/official/:provider" element={<OfficialPage />} />
        <Route path="/check/:kind?" element={<CheckPage />} />
        <Route path="/apply" element={<ApplyPage />} />
        <Route path="/r/d/:id" element={<LegacyReportRedirect />} />
        <Route path="/r/:id" element={<LegacyDetectRedirect />} />
        <Route path="/b/:id" element={<StoredRunPage />} />
        <Route path="/tools/iq" element={<IqPage />} />
        <Route path="/tools/codex-resets" element={<CodexPage />} />
        <Route path="/tools/api-speed" element={<SpeedPage />} />
        <Route path="/reputation" element={<ReputationPage />} />
        <Route path="/proposals" element={<ProposalsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/availability" element={<AvailabilityPage />} />
        <Route path="/model" element={<ModelListPage />} />
        <Route path="/model/:slug" element={<ModelPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/disclaimer" element={<DisclaimerPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/points" element={<PointsPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/submit" element={<Navigate to="/apply" replace />} />
        <Route path="/submissions" element={<SubmissionsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </Shell>
  );
}
