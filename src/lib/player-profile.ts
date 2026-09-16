export const MAX_PROFILE_PHOTO_BYTES = 200 * 1024;
export const MAX_PROFILE_UPLOAD_BYTES = 8 * 1024 * 1024;
export type PlayerProfileFields = {
  name: string;
  bio?: string;
  photoDataUrl?: string;
};

export function isValidProfilePhoto(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 23 + 4 * Math.ceil(MAX_PROFILE_PHOTO_BYTES / 3)
  )
    return false;
  if (!value.startsWith("data:image/jpeg;base64,")) return false;
  const encoded = value.slice(23);
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    return false;
  try {
    const bytes = atob(encoded);
    return (
      bytes.length >= 5 &&
      bytes.length <= MAX_PROFILE_PHOTO_BYTES &&
      btoa(bytes) === encoded &&
      bytes.charCodeAt(0) === 255 &&
      bytes.charCodeAt(1) === 216 &&
      bytes.charCodeAt(2) === 255 &&
      bytes.charCodeAt(bytes.length - 2) === 255 &&
      bytes.charCodeAt(bytes.length - 1) === 217
    );
  } catch {
    return false;
  }
}

function valid(value: unknown, withId: boolean): boolean {
  try {
    if (
      !value ||
      typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowed = withId
      ? ["id", "name", "bio", "photoDataUrl"]
      : ["name", "bio", "photoDataUrl"];
    if (
      Reflect.ownKeys(value).some(
        (key) =>
          typeof key !== "string" ||
          !allowed.includes(key) ||
          !Object.hasOwn(descriptors[key], "value") ||
          !descriptors[key].enumerable,
      )
    )
      return false;
    const record = value as Record<string, unknown>;
    const text = (
      v: unknown,
      max: number,
      required: boolean,
      multiline = false,
    ) =>
      typeof v === "string" &&
      v.length <= max &&
      v === v.trim() &&
      (!required || v.length > 0) &&
      !(
        multiline
          ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
          : /[\u0000-\u001f\u007f]/
      ).test(v);
    return (
      (!withId || text(record.id, 200, true)) &&
      text(record.name, 60, true) &&
      (!Object.hasOwn(record, "bio") || text(record.bio, 240, false, true)) &&
      (!Object.hasOwn(record, "photoDataUrl") ||
        isValidProfilePhoto(record.photoDataUrl))
    );
  } catch {
    return false;
  }
}
export function isValidPlayerProfile(
  value: unknown,
): value is PlayerProfileFields {
  return valid(value, false);
}
export function isValidSavedPlayerProfile(
  value: unknown,
): value is PlayerProfileFields & { id: string } {
  return valid(value, true);
}

/** Decode locally and discard the original; only the small JPEG is persisted. */
export async function prepareProfilePhoto(
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  const check = () => {
    if (signal?.aborted) throw new Error("Photo processing cancelled.");
  };
  check();
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size === 0 ||
    file.size > MAX_PROFILE_UPLOAD_BYTES
  )
    throw new Error("Choose a JPEG, PNG or WebP photo no larger than 8 MB.");
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  check();
  const matches =
    file.type === "image/jpeg"
      ? header[0] === 255 && header[1] === 216 && header[2] === 255
      : file.type === "image/png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => header[i] === v)
        : [82, 73, 70, 70].every((v, i) => header[i] === v) &&
          [87, 69, 66, 80].every((v, i) => header[i + 8] === v);
  if (!matches)
    throw new Error(
      "That file does not contain the selected image format. Choose another photo.",
    );
  const url = URL.createObjectURL(file);
  const img = new Image();
  let cancel: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        if (cancel) signal?.removeEventListener("abort", cancel);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error("The photo took too long to open. Try another image."),
          ),
        15000,
      );
      cancel = () => finish(new Error("Photo processing cancelled."));
      img.onload = () => finish();
      img.onerror = () =>
        finish(
          new Error("This photo could not be opened. Choose another image."),
        );
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      else img.src = url;
    });
    check();
    if (!img.naturalWidth || !img.naturalHeight)
      throw new Error("This photo has no readable image.");
    const scale = Math.min(1, 256 / img.naturalWidth, 256 / img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    try {
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("Photo processing is unavailable in this browser.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL("image/jpeg", 0.85);
      if (!isValidProfilePhoto(result))
        throw new Error(
          "The processed photo is too large or unreadable. Choose another image.",
        );
      return result;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    img.onload = null;
    img.onerror = null;
    img.src = "";
    URL.revokeObjectURL(url);
    if (cancel) signal?.removeEventListener("abort", cancel);
  }
}
