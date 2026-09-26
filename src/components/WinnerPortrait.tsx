"use client";
import { useState } from "react";
import { CrownIcon } from "./CrownIcon";
import { isValidProfilePhoto } from "../lib/player-profile";
import "./winner-portrait.css";

export function WinnerPortrait({
  name,
  photoDataUrl,
}: {
  name: string;
  photoDataUrl?: string;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const showPhoto =
    photoDataUrl !== failedPhoto && isValidProfilePhoto(photoDataUrl);
  if (!showPhoto) return <CrownIcon className="winner-crown" />;
  return (
    <span className="winner-portrait">
      {/* Stored profile images are validated JPEGs, not remote requests. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="winner-portrait-photo"
        src={photoDataUrl}
        alt={`${name}’s profile photo`}
        onError={() => setFailedPhoto(photoDataUrl)}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="winner-portrait-crown" src="/results/crown.svg" alt="" />
    </span>
  );
}
