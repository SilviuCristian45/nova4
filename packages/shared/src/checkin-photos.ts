import {
  CHECKIN_PHOTO_SLOTS,
  type CheckinPhotoSlot,
  type CheckinPhotoUrls,
  type WeeklyCheckin,
} from "./coach/types.ts";

// Private bucket storing optional front/back/side weekly check-in photos (<client_id>/<uuid>.jpg).
export const CHECKIN_PHOTO_BUCKET = "checkin-photos";
export const CHECKIN_PHOTO_LINK_SECONDS = 3600;

export type CheckinPhotoPaths = Record<CheckinPhotoSlot, string | null>;

const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function checkinPhotoPath(userId: string, photoId: string): string {
  return `${userId}/${photoId.toLowerCase()}.jpg`;
}

// Mirrors the Postgres CHECK constraint on weekly_checkins.photo_*_path.
export function isValidCheckinPhotoPath(path: string, userId: string): boolean {
  const prefix = `${userId}/`;
  if (!path.startsWith(prefix) || !path.endsWith(".jpg")) return false;
  const idPart = path.slice(prefix.length, -4);
  return UUID_LOWER.test(idPart);
}

export function validateCheckinPhotoPaths(
  input: Partial<Record<CheckinPhotoSlot, string | null | undefined>>,
  userId: string,
  t: (ro: string, en: string) => string,
): { ok: true; paths: CheckinPhotoPaths } | { ok: false; error: string } {
  const normalized: CheckinPhotoPaths = { front: null, back: null, side: null };
  for (const slot of CHECKIN_PHOTO_SLOTS) {
    const raw = input[slot];
    if (raw === null || raw === undefined || raw === "") {
      normalized[slot] = null;
      continue;
    }
    if (typeof raw !== "string" || !isValidCheckinPhotoPath(raw, userId)) {
      return {
        ok: false,
        error: t("Calea imaginii de check-in nu este validă.", "Invalid check-in photo path."),
      };
    }
    normalized[slot] = raw;
  }
  return { ok: true, paths: normalized };
}

export function checkinPhotoPathsFromRow(
  row: Pick<WeeklyCheckin, "photo_front_path" | "photo_back_path" | "photo_side_path">,
): CheckinPhotoPaths {
  return {
    front: row.photo_front_path ?? null,
    back: row.photo_back_path ?? null,
    side: row.photo_side_path ?? null,
  };
}

// Returns storage paths that were previously attached to a check-in but are no longer referenced after an edit.
export function diffRemovedCheckinPhotoPaths(prev: CheckinPhotoPaths, next: CheckinPhotoPaths): string[] {
  const kept = new Set(CHECKIN_PHOTO_SLOTS.map((slot) => next[slot]).filter((p): p is string => Boolean(p)));
  const removed: string[] = [];
  for (const slot of CHECKIN_PHOTO_SLOTS) {
    const oldPath = prev[slot];
    if (oldPath && !kept.has(oldPath) && !removed.includes(oldPath)) {
      removed.push(oldPath);
    }
  }
  return removed;
}

export function hasAnyCheckinPhoto(photoUrls?: CheckinPhotoUrls): boolean {
  if (!photoUrls) return false;
  return CHECKIN_PHOTO_SLOTS.some((slot) => Boolean(photoUrls[slot]));
}
