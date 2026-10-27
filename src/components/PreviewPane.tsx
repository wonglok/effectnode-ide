import { useEffect, useState } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';
import { useRuntimeStore } from '@/store/runtime';

/** The live iframe and its boot/error states. The dock owns the header. */
export function PreviewBody() {
  const status = useRuntimeStore((state) => state.status);
  const statusMessage = useRuntimeStore((state) => state.statusMessage);
  const previewUrl = useRuntimeStore((state) => state.previewUrl);
  const previewKey = useRuntimeStore((state) => state.previewKey);
  const attachPreview = useRuntimeStore((state) => state.attachPreview);
  const retryPreview = useRuntimeStore((state) => state.retryPreview);

  const [frameLoaded, setFrameLoaded] = useState(false);

  useEffect(() => {
    setFrameLoaded(false);
  }, [previewKey, status]);

  return (
    <div className="preview-body">
      {status === 'error' ? (
        <div className="preview-state is-error">
          <CircleAlert size={26} />
          <h3>Preview is offline</h3>
          <p>{statusMessage || 'The preview server could not start.'}</p>
          <p className="preview-hint">
            Service workers need <code>localhost</code> or HTTPS. If this persists, open the console for details.
          </p>
          <button className="solid-button small" onClick={() => void retryPreview()}>
            Retry preview
          </button>
        </div>
      ) : status === 'ready' && previewUrl ? (
        <>
          {!frameLoaded ? (
            <div className="preview-loading">
              <Loader2 size={18} className="spin" />
              <span>Resolving virtual preview…</span>
            </div>
          ) : null}
          <iframe
            key={previewKey}
            className="preview-frame"
            src={previewUrl}
            title="Live application preview"
            sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-pointer-lock allow-modals allow-downloads"
            onLoad={(event) => {
              setFrameLoaded(true);
              attachPreview(event.currentTarget.contentWindow);
            }}
          />
          <div className="preview-footer">
            <span className="preview-footer-dot" />
            <span>service worker</span>
            <span className="preview-footer-sep">/</span>
            <span>port 3000</span>
          </div>
        </>
      ) : (
        <div className="preview-state">
          <div className="boot-orbit">
            <span />
          </div>
          <h3>Booting preview</h3>
          <p>{statusMessage || 'Mounting the virtual file system and dev server…'}</p>
          <div className="boot-steps">
            <span className="is-done">virtual file system</span>
            <span>service worker</span>
            <span>vite dev server</span>
          </div>
        </div>
      )}
    </div>
  );
}
