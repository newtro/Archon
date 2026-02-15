import { useState } from "react";
import type { DockviewApi } from "dockview-react";
import { AppStateProvider, useAppState } from "./contexts/AppStateContext";
import { DockviewContext } from "./contexts/DockviewContext";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { TitleBar } from "./components/layout/TitleBar";
import { DockArea } from "./components/layout/DockArea";
import { HumanReviewModal } from "./components/flow/HumanReviewModal";
import { PublishFlowModal } from "./components/registry/PublishFlowModal";

function AppContent() {
  const {
    isConnected, connectionStatus, messages, activeModel,
    sidecarLatency, gitStatus,
    pendingReview, setPendingReview, send,
    publishingFlow, setPublishingFlow,
  } = useAppState();

  // DockviewApi state — lifted here so both Sidebar and DockArea share it
  const [dockApi, setDockApi] = useState<DockviewApi | null>(null);

  return (
    <DockviewContext.Provider value={dockApi}>
      <div className="app-layout">
        <TitleBar />
        <Sidebar />
        <main className="main-content">
          <DockArea onApiReady={setDockApi} />
        </main>
        <StatusBar
          isConnected={isConnected}
          connectionStatus={connectionStatus}
          messages={messages}
          activeModel={activeModel}
          sidecarLatency={sidecarLatency}
          gitStatus={gitStatus}
        />
        {pendingReview && (
          <HumanReviewModal
            review={pendingReview}
            onApprove={(feedback, editedContent) => {
              send({
                type: "resolve_review",
                nodeId: pendingReview.nodeId,
                approved: true,
                feedback: feedback || undefined,
                editedContent: editedContent || undefined,
              });
              setPendingReview(null);
            }}
            onReject={(feedback) => {
              send({
                type: "resolve_review",
                nodeId: pendingReview.nodeId,
                approved: false,
                feedback,
              });
              setPendingReview(null);
            }}
          />
        )}
        {publishingFlow && (
          <PublishFlowModal
            flow={publishingFlow}
            onClose={() => setPublishingFlow(null)}
          />
        )}
      </div>
    </DockviewContext.Provider>
  );
}

function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  );
}

export default App;
