"use client";
import { useEffect } from "react";
import { reportBrowserFailure } from "../lib/browser-diagnostics";
export default function ErrorPage({ reset }: { reset: () => void }) {
  useEffect(reportBrowserFailure, []);
  return (
    <main className="recovery">
      <h1>Let’s recover your game.</h1>
      <p>
        Amberly encountered a problem. Reloading does not intentionally erase
        saved games.
      </p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
