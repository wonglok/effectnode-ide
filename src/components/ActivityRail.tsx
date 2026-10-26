import { CircleHelp, Files, FolderKanban } from "lucide-react";
import { useRuntimeStore } from "@/store/runtime";
import { useUiStore } from "@/store/ui";

export function ActivityRail() {
  const explorerOpen = useUiStore((state) => state.explorerOpen);
  const toggleExplorer = useUiStore((state) => state.toggleExplorer);
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);
  const setProjectSwitcherOpen = useUiStore(
    (state) => state.setProjectSwitcherOpen,
  );
  const status = useRuntimeStore((state) => state.status);

  //

  return (
    <nav className="rail" aria-label="Activity">
      <div className="rail-group">
        <button
          className="rail-button"
          onClick={() => setProjectSwitcherOpen(true)}
          title="Projects & versions (⇧⌘O)"
        >
          <FolderKanban size={18} />
        </button>
        <button
          className={`rail-button ${explorerOpen ? "is-active" : ""}`}
          onClick={toggleExplorer}
          title="Toggle explorer & editor column (⌘B)"
        >
          <Files size={18} />
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
