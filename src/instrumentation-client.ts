import { reportBrowserFailure } from "./lib/browser-diagnostics";
window.addEventListener("error", reportBrowserFailure);
window.addEventListener("unhandledrejection", reportBrowserFailure);
