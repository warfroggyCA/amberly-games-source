import type { ReactNode } from "react";

type IconName =
  | "share"
  | "settings"
  | "more"
  | "erase"
  | "scores"
  | "menu"
  | "finish"
  | "pass"
  | "exchange"
  | "pause"
  | "play"
  | "undo"
  | "home"
  | "board"
  | "trophy"
  | "history"
  | "players";

const paths: Record<IconName, ReactNode> = {
  share: <path d="M12 15V2m-4 4 4-4 4 4M7 10H4v11h16V10h-3" />,
  settings: (
    <>
      <path
        d="m9 3 .5-1h5l.5 3 2 1.2 2.8-1 2.5 4.3-2.3 2v2.4l2.3 2-2.5 4.3-2.8-1-2 1.2-.5 2.6h-5L9 20l-2-1.2-2.8 1-2.5-4.3 2.3-2v-2.4l-2.3-2 2.5-4.3L7 6l2-1.2V3Z"
        transform="translate(0 -.3) scale(1 .95)"
      />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  erase: (
    <>
      <path d="m9 5-7 7 7 7h12V5H9Z" />
      <path d="m12 9 6 6m0-6-6 6" />
    </>
  ),
  scores: (
    <>
      <rect x="5" y="3" width="15" height="18" rx="2" />
      <path d="M3 7h4M3 12h4M3 17h4M11 8h5m-5 4h5m-5 4h3" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  finish: (
    <>
      <path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0" />
      <path d="M10 5v9m5-8v9" opacity=".45" />
    </>
  ),
  pass: (
    <>
      <path d="m5 5 10 7-10 7V5Z" />
      <path d="M19 5v14" />
    </>
  ),
  exchange: (
    <>
      <path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" />
    </>
  ),
  pause: (
    <>
      <rect x="5" y="4" width="4" height="16" rx="1" />
      <rect x="15" y="4" width="4" height="16" rx="1" />
    </>
  ),
  play: <path d="m7 4 13 8-13 8V4Z" />,
  undo: (
    <>
      <path d="m8 3-5 5 5 5M3 8h10a7 7 0 0 1 0 14" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7M5 9v12h14V9" />
      <path d="M9 21v-8h6v8" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 3h10v5a5 5 0 0 1-10 0V3Zm5 10v5m-5 3h10m-8-3h6" />
      <path d="M7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4" />
    </>
  ),
  history: (
    <>
      <path d="M3 11a9 9 0 1 1 3 8M3 4v7h7" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  players: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v1" />
    </>
  ),
};

/** Decorative artwork; the surrounding button supplies its accessible name. */
export function TabletopIcon({ name }: { name: IconName }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
