"use client";
import { useId } from "react";

/** Shared polished gold, with unique paint IDs for every rendered crown. */
export function CrownIcon({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg className={className} viewBox="0 0 80 64" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="0.8">
          <stop offset="0" stopColor="#fff3aa" />
          <stop offset=".2" stopColor="#f6c94e" />
          <stop offset=".39" stopColor="#ad660e" />
          <stop offset=".52" stopColor="#ffe99a" />
          <stop offset=".7" stopColor="#f3bc35" />
          <stop offset="1" stopColor="#a96214" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1a0" />
          <stop offset=".35" stopColor="#f6c342" />
          <stop offset=".7" stopColor="#b17312" />
          <stop offset="1" stopColor="#efc350" />
        </linearGradient>
        <radialGradient id={`${id}-tip`} cx=".32" cy=".22" r=".8">
          <stop offset="0" stopColor="#fffadd" />
          <stop offset=".28" stopColor="#ffdf73" />
          <stop offset=".65" stopColor="#e9a626" />
          <stop offset="1" stopColor="#976010" />
        </radialGradient>
      </defs>
      <path
        d="M10 17 25 30 40 8 55 30 70 17 62 48Q40 55 18 48Z"
        fill={`url(#${id}-gold)`}
        stroke="#895310"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="m14 21 7 23q19 6 38 0l7-23M28 31l12-18 12 18"
        fill="none"
        stroke="#fff0a7"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="m19 49 1 8q20 5 40 0l1-8q-21 6-42 0Z"
        fill={`url(#${id}-rim)`}
        stroke="#895310"
        strokeWidth="1.2"
      />
      <path
        d="M23 51q17 4 34 0"
        fill="none"
        stroke="#fff4b8"
        strokeWidth="1.4"
      />
      <g fill={`url(#${id}-tip)`} stroke="#986218" strokeWidth="1">
        <circle cx="10" cy="14" r="5" />
        <circle cx="70" cy="14" r="5" />
        <circle cx="40" cy="7" r="5" />
      </g>
      <path
        d="m56 25 1.2 4.8L62 31l-4.8 1.2L56 37l-1.2-4.8L50 31l4.8-1.2Z"
        fill="#fff9d5"
        stroke="none"
      />
    </svg>
  );
}
