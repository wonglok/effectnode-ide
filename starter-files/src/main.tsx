import "./tailwind-theme.ts";
import "@tailwindcss/browser";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles.css";
import "./components/landing.css";
import "./components/scene-stage.css";
import "./components/splash.css";

// No StrictMode here on purpose: a WebGPU renderer owns its canvas context, and
// the development double-mount would initialise two renderers on one canvas.
createRoot(document.getElementById("root")!).render(<App />);
