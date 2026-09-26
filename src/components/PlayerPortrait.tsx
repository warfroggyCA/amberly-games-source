"use client";
import { useMemo, useState } from "react";
import { CrownIcon } from "./CrownIcon";
import { PortraitCrown } from "./PortraitCrown";
import { isValidProfilePhoto } from "../lib/player-profile";
import "./winner-portrait.css";

/** A noninteractive portrait, safe inside a history link or button. */
export function PlayerPortrait({
  name,
  photoDataUrl,
  crowned = false,
  lazy = false,
}: {
  name: string;
  photoDataUrl?: string;
  crowned?: boolean;
  lazy?: boolean;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const validPhoto = useMemo(
    () => isValidProfilePhoto(photoDataUrl),
    [photoDataUrl],
  );
  if (!validPhoto || photoDataUrl === failedPhoto)
    return crowned ? (
      <CrownIcon className="winner-crown" />
    ) : (
      <span className="player-portrait-initial" aria-hidden="true">
        {Array.from(name)[0]?.toUpperCase() || "?"}
      </span>
    );
  return (
    <span className={`player-portrait${crowned ? " winner-portrait" : ""}`}>
      {/* Validated stored JPEGs never issue remote tracking requests. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="winner-portrait-photo"
        src={photoDataUrl}
        alt={`${name}’s profile photo`}
        width={256}
        height={256}
        loading={lazy ? "lazy" : undefined}
        decoding="async"
        onError={() => setFailedPhoto(photoDataUrl)}
      />
      {crowned && <PortraitCrown />}
    </span>
  );
}
