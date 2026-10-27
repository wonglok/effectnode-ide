import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import "./styles.css";
import "./tailwind.css";

const rootElement = document.getElementById("root")!;
const params = new URLSearchParams(window.location.search);

/**
 * Vercel MCP redirect target. The OAuth popup lands on `/?mcp=callback`; this
 * page forwards the code to the opener, which owns the PKCE verifier, and then
 * closes itself. Rendering the full IDE here would boot a second runtime for
 * no reason.
 */
function renderMcpCallback(): void {
  const code = params.get("code") ?? undefined;
  const state = params.get("state") ?? undefined;
  const error = params.get("error") ?? undefined;
  const errorDescription = params.get("error_description") ?? undefined;
  const payload = { type: "forge:mcp-oauth", code, state, error, errorDescription };

  // Vercel's authorize page sends COOP restrict-properties, so
  // `window.opener` is usually gone by the time we get here. Same-origin
  // BroadcastChannel and the localStorage `storage` event both still reach the
  // opener; postMessage stays as a fallback.
  try {
    const channel = new BroadcastChannel("forge:mcp-oauth");
    channel.postMessage(payload);
    channel.close();
  } catch {
    // BroadcastChannel is unavailable; the storage fallback covers it.
  }
  try {
    window.localStorage.setItem(
      "forge.vercelMcpCallback.v1",
      JSON.stringify({ ...payload, at: Date.now() }),
    );
  } catch {
    // Storage can be unavailable in private or hardened contexts.
  }
  if (window.opener) {
    window.opener.postMessage(payload, window.location.origin);
  }

  // Strip the one-time code from the address bar and history.
  window.history.replaceState({}, "", "/");

  document.title = error
    ? "Vercel MCP — not connected"
    : "Vercel authorization received";
  document.body.style.cssText =
    "margin:0;height:100vh;display:grid;place-items:center;background:#0b0c0b;color:#e8e6e0;font-family:ui-sans-serif,system-ui,sans-serif";

  const card = document.createElement("div");
  card.style.cssText =
    "max-width:380px;padding:26px 24px;text-align:center;border:1px solid #2a2c2a;border-radius:12px;background:#121412";

  const title = document.createElement("h1");
  title.textContent = error ? "Vercel sign-in failed" : "Vercel authorization received";
  title.style.cssText = "margin:0 0 8px;font-size:15px;letter-spacing:.04em";

  const body = document.createElement("p");
  body.textContent = error
    ? errorDescription || error || "Vercel did not approve the connection."
    : "Forge is finishing the connection. This window closes automatically.";
  body.style.cssText =
    "margin:0;font-size:12px;line-height:1.6;color:#9aa09a";

  card.append(title, body);
  rootElement.replaceChildren(card);

  if (!error && code) {
    window.setTimeout(() => window.close(), 900);
  }
  // A tab opened outside Forge has no opener to consume the fallback payload.
  window.setTimeout(() => {
    try {
      if (!window.opener) {
        window.localStorage.removeItem("forge.vercelMcpCallback.v1");
      }
    } catch {
      // Nothing to clean up.
    }
  }, 15_000);
}

if (params.get("mcp") === "callback") {
  renderMcpCallback();
} else {
  createRoot(rootElement).render(
    <StrictMode>
      <AuthGate>
        <App />
      </AuthGate>
    </StrictMode>,
  );
}
