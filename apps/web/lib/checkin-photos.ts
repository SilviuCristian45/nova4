import type { SupabaseClient } from "@supabase/supabase-js";
import { removeAllPhotoFiles } from "./photos.ts";
import {
  CHECKIN_PHOTO_BUCKET,
  CHECKIN_PHOTO_LINK_SECONDS,
} from "@replog/shared/checkin-photos";
import type {
  CheckinPhotoUrls,
  WeeklyCheckin,
  WeeklyCheckinWithPhotos,
} from "@replog/shared/coach/types";

export {
  CHECKIN_PHOTO_BUCKET,
  CHECKIN_PHOTO_LINK_SECONDS,
  checkinPhotoPath,
  isValidCheckinPhotoPath,
  validateCheckinPhotoPaths,
  checkinPhotoPathsFromRow,
  diffRemovedCheckinPhotoPaths,
  hasAnyCheckinPhoto,
  type CheckinPhotoPaths,
} from "@replog/shared/checkin-photos";

// Batch-signs all photo paths across a list of weekly check-ins in one Storage request.
// Tolerates a missing bucket (migration not applied yet) so pages never crash.
export async function attachCheckinPhotoUrls<T extends WeeklyCheckin>(
  supabase: SupabaseClient,
  rows: T[],
  expiresIn = CHECKIN_PHOTO_LINK_SECONDS,
): Promise<(T & WeeklyCheckinWithPhotos)[]> {
  if (rows.length === 0) return [];

  const uniquePaths = new Set<string>();
  for (const row of rows) {
    if (row.photo_front_path) uniquePaths.add(row.photo_front_path);
    if (row.photo_back_path) uniquePaths.add(row.photo_back_path);
    if (row.photo_side_path) uniquePaths.add(row.photo_side_path);
  }

  const signedByPath = new Map<string, string>();
  if (uniquePaths.size > 0) {
    const { data, error } = await supabase.storage
      .from(CHECKIN_PHOTO_BUCKET)
      .createSignedUrls([...uniquePaths], expiresIn);
    if (!error && data) {
      for (const item of data) {
        if (item.path && item.signedUrl) {
          signedByPath.set(item.path, item.signedUrl);
        }
      }
    }
  }

  return rows.map((row) => {
    const photoUrls: CheckinPhotoUrls = {};
    if (row.photo_front_path && signedByPath.has(row.photo_front_path)) {
      photoUrls.front = signedByPath.get(row.photo_front_path);
    }
    if (row.photo_back_path && signedByPath.has(row.photo_back_path)) {
      photoUrls.back = signedByPath.get(row.photo_back_path);
    }
    if (row.photo_side_path && signedByPath.has(row.photo_side_path)) {
      photoUrls.side = signedByPath.get(row.photo_side_path);
    }
    return { ...row, photoUrls };
  });
}

export async function removeAllCheckinPhotoFiles(supabase: SupabaseClient, userId: string): Promise<void> {
  return removeAllPhotoFiles(supabase, userId, CHECKIN_PHOTO_BUCKET);
}
