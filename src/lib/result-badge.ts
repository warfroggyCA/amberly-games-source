import { LETTER_VALUES } from "../domain/board";

export type BadgeResult = {
  gameId: string;
  game: "Scrabble" | "Crokinole";
  winners: { name: string; score: number }[];
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

  // One band per winner; long team names use readable lettering rather than tiny tiles.
  const names = result.winners.flatMap((winner) => badgeNameRows(winner.name));
  const band = 190 / names.length;
  names.forEach((name, index) => {
    const chars = badgeCharacters(name);
    const size = Math.min(170, band - 8, 880 / Math.max(chars.length, 1));
    const cy = 660 + band * (index + 0.5);
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
