import { CircleHelp, Files, FolderArchive } from "lucide-react";
import { useRuntimeStore } from "@/store/runtime";
import { useUiStore } from "@/store/ui";

export function ActivityRail() {
  const explorerOpen = useUiStore((state) => state.explorerOpen);
  const sidebarView = useUiStore((state) => state.sidebarView);
  const toggleExplorer = useUiStore((state) => state.toggleExplorer);
  const setSidebarView = useUiStore((state) => state.setSidebarView);
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);
  const status = useRuntimeStore((state) => state.status);

  const filesActive = explorerOpen && sidebarView === "files";
  const referencesActive = explorerOpen && sidebarView === "references";

  const showFiles = () => {
    if (filesActive) toggleExplorer();
    else setSidebarView("files");
  };

  const showReferences = () => {
    if (referencesActive) toggleExplorer();
    else setSidebarView("references");
  };

  return (
    <nav className="rail" aria-label="Activity">
      <div className="rail-group">
        <button
          className={`rail-button ${filesActive ? "is-active" : ""}`}
          onClick={showFiles}
          title="Explorer (⌘B)"
        >
          <Files size={18} />
        </button>
        <button
          className={`rail-button ${referencesActive ? "is-active" : ""}`}
          onClick={showReferences}
          title="References — upload a ZIP"
          aria-label="References and ZIP uploads"
        >
          <FolderArchive size={18} />
        </button>
        {/* <button
          className={`rail-button ${terminalOpen && terminalTab === "console" ? "is-active" : ""}`}
          onClick={() => setTerminalTab("console")}
          title="Runtime console (⌘J)"
        >
          <SquareTerminal size={18} />
        </button> */}
      </div>

      <div className="rail-group rail-bottom">
        <button
          className="rail-button"
          onClick={() => setShortcutsOpen(true)}
          title="Help & shortcuts"
        >
          <CircleHelp size={17} />
        </button>
        <div className="rail-wordmark" aria-hidden="true">
          almostnode
        </div>
        <div
          className={`rail-led status-${status}`}
          title={`Runtime ${status}`}
        />
      </div>
    </nav>
  );
}
