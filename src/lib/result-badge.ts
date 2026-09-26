import { isValidProfilePhoto } from "./player-profile";
import { LETTER_VALUES } from "../domain/board";

export type BadgeResult = {
  gameId: string;
  game: "Scrabble" | "Crokinole";
  winners: { name: string; score: number; photoDataUrl?: string }[];
  note?: string;
};

export function badgeCharacters(name: string): string[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      name.normalize("NFC").toLocaleUpperCase(),
    ),
    (part) => part.segment,
  );
}

/** Keep doubles names legible without shrinking an entire team onto one line. */
export function badgeNameRows(name: string): string[] {
  const words = name.trim().split(/\s+/u);
  if (badgeCharacters(name).length <= 12 || words.length < 2) return [name];
  let split = 1;
  let difference = Infinity;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" ");
    const right = words.slice(i).join(" ");
    const d = Math.abs(
      badgeCharacters(left).length - badgeCharacters(right).length,
    );
    if (d < difference) {
      difference = d;
      split = i;
    }
  }
  return [words.slice(0, split).join(" "), words.slice(split).join(" ")];
}

async function loadArtwork(
  path: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error("Badge artwork is unavailable.");
  const url = URL.createObjectURL(await response.blob());
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Optional photos must never prevent a result from being shared. Only saved JPEGs
 * are accepted, avoiding remote tracking requests and tainted export canvases. */
async function loadProfilePhoto(
  value: string | undefined,
  signal: AbortSignal,
) {
  if (!isValidProfilePhoto(value)) return null;
  try {
    return await loadArtwork(value, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

function drawPortrait(
  ctx: CanvasRenderingContext2D,
  photo: HTMLImageElement,
  x: number,
  y: number,
  radius: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  const side = Math.min(photo.naturalWidth, photo.naturalHeight);
  ctx.drawImage(
    photo,
    (photo.naturalWidth - side) / 2,
    (photo.naturalHeight - side) / 2,
    side,
    side,
    x - radius,
    y - radius,
    radius * 2,
    radius * 2,
  );
  ctx.restore();
  const gold = ctx.createLinearGradient(
    x - radius,
    y - radius,
    x + radius,
    y + radius,
  );
  gold.addColorStop(0, "#fff0a7");
  gold.addColorStop(0.4, "#b67b22");
  gold.addColorStop(0.7, "#f9d475");
  gold.addColorStop(1, "#a26c1b");
  ctx.strokeStyle = gold;
  ctx.lineWidth = 10;
  ctx.stroke();
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  maxWidth: number,
) {
  ctx.font = `bold ${size}px Georgia, serif`;
  while (ctx.measureText(text).width > maxWidth && size > 12)
    ctx.font = `bold ${--size}px Georgia, serif`;
}

/** Render real artwork once: on-screen preview and shared PNG are identical. */
export async function makeResultBadge(
  result: BadgeResult,
  signal: AbortSignal,
): Promise<Blob> {
  const [background, piece] = await Promise.all([
    loadArtwork(`/results/${result.game.toLowerCase()}-victory.webp`, signal),
    loadArtwork(
      result.game === "Scrabble"
        ? "/results/name-tile.webp"
        : "/results/name-disc-light.webp",
      signal,
    ),
  ]);
  const photos = await Promise.all(
    result.winners.map((winner) =>
      loadProfilePhoto(winner.photoDataUrl, signal),
    ),
  );
  const hasPhotos = photos.some(Boolean);
  // The optional crown uses the same vector artwork as the in-app portrait.
  const crown = hasPhotos
    ? await loadArtwork("/results/crown.svg", signal).catch((error) => {
        if (signal.aborted) throw error;
        return null;
      })
    : null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image creation is unavailable.");
  ctx.drawImage(background, 0, 0, 1080, 1080);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffebad";
  fitText(ctx, "GAME NIGHT WINNER", 33, 870);
  ctx.fillText("GAME NIGHT WINNER", 540, 264);

  if (hasPhotos && crown) {
    // Opaque framed medallion covers the original artwork's central crown.
    ctx.beginPath();
    ctx.arc(540, 530, 198, 0, Math.PI * 2);
    ctx.fillStyle = "#12392b";
    ctx.fill();
    ctx.strokeStyle = "#d8ae50";
    ctx.lineWidth = 8;
    ctx.stroke();
    if (photos.length === 1 && photos[0]) {
      drawPortrait(ctx, photos[0], 540, 530, 190);
    } else {
      const columns = Math.min(2, photos.length);
      const rows = Math.ceil(photos.length / columns);
      const radius = rows > 1 ? 70 : 80;
      photos.forEach((photo, index) => {
        const x = 540 + ((index % columns) - (columns - 1) / 2) * 174;
        const y = 530 + (Math.floor(index / columns) - (rows - 1) / 2) * 164;
        if (photo) drawPortrait(ctx, photo, x, y, radius);
        else
          ctx.drawImage(
            crown,
            x - radius,
            y - radius * 0.8,
            radius * 2,
            radius * 1.6,
          );
      });
    }
    ctx.drawImage(crown, 430, 286, 220, 176);
  }

  // One band per winner; long team names use readable lettering rather than tiny tiles.
  const names = result.winners.flatMap((winner) => badgeNameRows(winner.name));
  const portraitsDrawn = hasPhotos && !!crown;
  const band = (portraitsDrawn ? 120 : 190) / names.length;
  names.forEach((name, index) => {
    const chars = badgeCharacters(name);
    const size = Math.min(170, band - 8, 880 / Math.max(chars.length, 1));
    const cy = (portraitsDrawn ? 730 : 660) + band * (index + 0.5);
    if (size < 42) {
      ctx.fillStyle = "#fff4d5";
      fitText(ctx, name, Math.min(52, band * 0.7), 900);
      ctx.fillText(name, 540, cy);
      return;
    }
    const left = 540 - (chars.length * size) / 2;
    chars.forEach((letter, i) => {
      if (!letter.trim()) return;
      const x = left + size * i;
      ctx.save();
      // Trim the supplied artwork's solid backdrop, retaining its real wood edge.
      if (result.game === "Crokinole") {
        ctx.beginPath();
        ctx.ellipse(
          x + size / 2,
          cy - 2,
          (size - 4) / 2,
          (size - 4) / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.clip();
        ctx.drawImage(
          piece,
          20,
          17,
          472,
          470,
          x + 2,
          cy - size / 2,
          size - 4,
          size - 4,
        );
      } else {
        ctx.drawImage(
          piece,
          26,
          35,
          460,
          438,
          x + 2,
          cy - size / 2,
          size - 4,
          size - 4,
        );
      }
      ctx.fillStyle = result.game === "Crokinole" ? "#382313" : "#fff0cc";
      ctx.shadowColor = result.game === "Crokinole" ? "#fff0cc" : "#241207";
      ctx.shadowBlur = result.game === "Crokinole" ? 0 : 2;
      ctx.shadowOffsetY = result.game === "Crokinole" ? 1 : 2;
      ctx.font = `bold ${size * 0.62}px ${result.game === "Scrabble" ? "Arial, sans-serif" : "Georgia, serif"}`;
      ctx.fillText(letter, x + size / 2, cy, size * 0.82);
      const points = LETTER_VALUES[letter as keyof typeof LETTER_VALUES];
      if (result.game === "Scrabble" && points !== undefined) {
        ctx.font = `bold ${size * 0.16}px Arial, sans-serif`;
        ctx.fillText(String(points), x + size * 0.82, cy + size * 0.3);
      }
      ctx.restore();
    });
  });
  ctx.fillStyle = "#ffebad";
  ctx.shadowColor = "#231006";
  ctx.shadowOffsetY = 3;
  ctx.shadowBlur = 3;
  const score = `${result.winners[0].score} POINTS`;
  fitText(ctx, score, 80, 780);
  const letters = Array.from(score);
  const widths = letters.map((letter) => ctx.measureText(letter).width);
  let cursor = -widths.reduce((sum, width) => sum + width, 0) / 2;
  // Match the ribbon: the middle rises gently and the ends turn down.
  const radius = 2400;
  letters.forEach((letter, index) => {
    const offset = cursor + widths[index] / 2;
    ctx.save();
    ctx.translate(540 + offset, 915 + (offset * offset) / (2 * radius));
    ctx.rotate(Math.atan(offset / radius));
    ctx.fillText(letter, 0, 0);
    ctx.restore();
    cursor += widths[index];
  });
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = "#fff4d5";
  fitText(ctx, result.note ?? "", 22, 960);
  ctx.fillText(result.note ?? "", 540, 1040);
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not create badge image.")),
      "image/png",
    ),
  );
}
