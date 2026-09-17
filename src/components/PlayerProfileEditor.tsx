"use client";
import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import {
  isValidPlayerProfile,
  prepareProfilePhoto,
  type PlayerProfileFields,
} from "../lib/player-profile";
import { Modal } from "./Modal";
import "./player-profile.css";

export function PlayerProfileEditor({
  player,
  onSave,
  onClose,
}: {
  player: PlayerProfileFields & { id: string };
  onSave: (updates: PlayerProfileFields) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(player.name);
  const [bio, setBio] = useState(player.bio ?? "");
  const [photo, setPhoto] = useState(player.photoDataUrl);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const hint = useId();
  useEffect(() => {
    mounted.current = true;
    const pendingRequest = request;
    return () => {
      mounted.current = false;
      pendingRequest.current++;
      controller.current?.abort();
    };
  }, []);
  async function choose(file: File) {
    const version = ++request.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setProcessing(true);
    setError(null);
    try {
      const result = await prepareProfilePhoto(file, abort.signal);
      if (mounted.current && version === request.current) setPhoto(result);
    } catch (e) {
      if (mounted.current && version === request.current)
        setError(
          e instanceof Error ? e.message : "This photo could not be opened.",
        );
    } finally {
      if (mounted.current && version === request.current) {
        setProcessing(false);
        controller.current = null;
      }
    }
  }
  function removePhoto() {
    request.current++;
    controller.current?.abort();
    controller.current = null;
    setProcessing(false);
    setPhoto(undefined);
    setError(null);
  }
  const updates: PlayerProfileFields = {
    name: name.trim(),
    ...(bio.trim() ? { bio: bio.trim() } : {}),
    ...(photo ? { photoDataUrl: photo } : {}),
  };
  async function save() {
    if (savingRef.current || processing || !isValidPlayerProfile(updates))
      return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const success = await onSave(updates);
      if (mounted.current) {
        if (success) onClose();
        else
          setError(
            "Your changes could not be saved. They are still here; please try again.",
          );
      }
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "Your changes could not be saved. Please try again.",
        );
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <Modal title="Edit player profile" onClose={onClose}>
      <form
        className="player-profile-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="muted">
          Add a familiar face and something worth knowing. Profiles are saved in
          this browser; family accounts are not connected yet.
        </p>
        <div className="profile-photo-editor">
          {photo ? (
            <Image
              unoptimized
              className="profile-photo-preview"
              src={photo}
              alt="Selected profile photo"
              width={96}
              height={96}
            />
          ) : (
            <span
              className="profile-photo-placeholder"
              aria-label="No profile photo"
            >
              {name.trim().slice(0, 1).toUpperCase() || "?"}
            </span>
          )}
          <div>
            <label className="field">
              Profile photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={saving}
                aria-describedby={hint}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void choose(file);
                }}
              />
            </label>
            <small id={hint}>
              JPEG, PNG or WebP · up to 8 MB. Resized for your player profile.
            </small>
            {(photo || processing) && (
              <button
                className="text-button"
                type="button"
                disabled={saving}
                onClick={removePhoto}
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
        {processing && <p role="status">Preparing photo…</p>}
        <label className="field">
          Name
          <input
            required
            maxLength={60}
            value={name}
            disabled={saving}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="field">
          About this player
          <textarea
            rows={3}
            maxLength={240}
            value={bio}
            disabled={saving}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Favourite word, hobbies, or a little family trivia…"
          />
          <small>{bio.length}/240 characters</small>
        </label>
        <p className="muted">
          Name changes apply to the player profile and future games. Names
          recorded in existing games stay as they were.
        </p>
        {error && (
          <p className="inline-message" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button light"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={saving || processing || !isValidPlayerProfile(updates)}
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
