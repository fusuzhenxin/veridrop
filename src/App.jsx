import { Navigate, Route, Routes } from "react-router-dom";
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

export default function App() {
  return (
    <Shell>
      <RunKeeper />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/list" element={<ListPage />} />
        <Route path="/cat/:cat" element={<ListPage />} />
        <Route path="/site/:token" element={<StationPage />} />
        <Route path="/station/:slug" element={<StationPage />} />
        <Route path="/official/:provider" element={<OfficialPage />} />
        <Route path="/check/:kind?" element={<CheckPage />} />
        <Route path="/apply" element={<ApplyPage />} />
        <Route path="/r/d/:id" element={<ReportPage />} />
        <Route path="/r/:id" element={<DetectRunPage />} />
        <Route path="/b/:id" element={<BasicRunPage />} />
        <Route path="/tools/iq" element={<IqPage />} />
        <Route path="/tools/codex-resets" element={<CodexPage />} />
        <Route path="/tools/api-speed" element={<SpeedPage />} />
        <Route path="/reputation" element={<ReputationPage />} />
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
