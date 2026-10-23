import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorState } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import type { ViewUpdate } from '@codemirror/view';
import { X } from 'lucide-react';
import { basename } from '@/lib/paths';
import { languageColor, languageFor, languageLabel } from '@/lib/file-tree';
import { useWorkspaceStore } from '@/store/workspace';
import { editorTheme, languageExtensions } from './editor/theme';

export function EditorPane() {
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const activeFile = useWorkspaceStore((state) => state.activeFile);
  const buffers = useWorkspaceStore((state) => state.buffers);
  const cursor = useWorkspaceStore((state) => state.cursor);
  const setActiveFile = useWorkspaceStore((state) => state.setActiveFile);
  const closeFile = useWorkspaceStore((state) => state.closeFile);
  const setBuffer = useWorkspaceStore((state) => state.setBuffer);
  const setCursor = useWorkspaceStore((state) => state.setCursor);

  const language = activeFile ? languageFor(activeFile) : 'text';
  const extensions = useMemo(() => languageExtensions(language), [language]);
  const value = activeFile ? buffers[activeFile] ?? '' : '';

  const onUpdate = (update: ViewUpdate) => {
    if (!update.selectionSet && !update.docChanged) return;
    const head = update.state.selection.main.head;
    const line = update.state.doc.lineAt(head);
    setCursor({ line: line.number, column: head - line.from + 1 });
  };

  return (
    <section className="editor-pane">
      <div className="tabbar">
        <div className="tabs-scroll">
          {openFiles.map((file) => {
            const isActive = file === activeFile;
            return (
              <div
                key={file}
                className={`tab ${isActive ? 'is-active' : ''}`}
                onClick={() => setActiveFile(file)}
                onAuxClick={(event) => {
                  if (event.button === 1) closeFile(file);
                }}
                title={file}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActiveFile(file);
                  }
                }}
              >
                <span className="tab-dot" style={{ background: languageColor(file) }} />
                <span className="tab-name">{basename(file)}</span>
                <button
                  className="tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeFile(file);
                  }}
                  title="Close file"
                  aria-label={`Close ${basename(file)}`}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          {openFiles.length === 0 ? <span className="tabbar-empty">No open editors</span> : null}
        </div>
      </div>

      {activeFile ? (
        <>
          <div className="editor-meta">
            <span className="editor-path">{activeFile}</span>
            <div className="editor-meta-right">
              <span>{languageLabel(activeFile)}</span>
              <span className="editor-meta-sep">/</span>
              <span>
                Ln {cursor.line}, Col {cursor.column}
              </span>
            </div>
          </div>
          <div className="editor-body">
            <CodeMirror
              key={activeFile}
              value={value}
              height="100%"
              theme={editorTheme}
              extensions={[
                ...extensions,
                EditorState.tabSize.of(2),
                indentUnit.of('  '),
              ]}
              onChange={(next) => {
                if (activeFile) setBuffer(activeFile, next);
              }}
              onUpdate={onUpdate}
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: false,
                searchKeymap: false,
              }}
              style={{ height: '100%' }}
            />
          </div>
        </>
      ) : (
        <div className="editor-empty">
          <div className="empty-mark">F</div>
          <h2>Nothing open</h2>
          <p>Choose a file in the explorer, or run <code>open src/App.tsx</code> in the shell.</p>
          <div className="empty-keys">
            <span><kbd>⌘B</kbd> explorer</span>
            <span><kbd>⌘J</kbd> terminal</span>
            <span><kbd>⌘S</kbd> save project</span>
          </div>
        </div>
      )}
    </section>
  );
}
