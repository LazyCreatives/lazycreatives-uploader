import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { IS_COMPANION } from "./companion";
import { TitleBar } from "./components/Desktop";
// Bundled fonts so the app looks the same on every computer (shared with Backups).
import "@fontsource/schibsted-grotesk/400.css";
import "@fontsource/schibsted-grotesk/500.css";
import "@fontsource/schibsted-grotesk/600.css";
import "@fontsource/schibsted-grotesk/700.css";
import "@fontsource/bebas-neue";  // app name only
import "./lazy-ui.css";  // shared look (same file in Backups)
import "./theme.css";    // Uploader-only bits
import "./companion.css"; // the narrow window and its sidebar button; after the shared styles so it wins ties
import { Companion } from "./screens/Companion";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TitleBar />
    {/* #companion: the narrow window beside the music program (see companion.js) */}
    {IS_COMPANION ? <Companion /> : <App />}
  </StrictMode>
);
