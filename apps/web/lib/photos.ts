import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET } from "@replog/shared/photos";

export {
  PHOTO_BUCKET,
  PHOTO_POSES,
  PHOTO_NOTE_MAX,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_PER_USER,
  PHOTO_MAX_EDGE,
  isPhotoPose,
  photoPath,
  drivePhotoName,
  fitWithin,
  parsePhotoRow,
  type PhotoPose,
  type PhotoRow,
} from "@replog/shared/photos";

// Deletes every image file of a user (account / data deletion). Works with the user's own session (the bucket
// policy lets an owner delete their folder) as well as with the service-role client. A missing bucket (migration
// not applied) means there is nothing to delete.
export async function removeAllPhotoFiles(supabase: SupabaseClient, userId: string, bucketName = PHOTO_BUCKET): Promise<void> {
  const bucket = supabase.storage.from(bucketName);
  for (;;) {
    const { data, error } = await bucket.list(userId, { limit: 100 });
    if (error) {
      if (/not found|does not exist/i.test(error.message)) return;
      throw new Error(`${bucketName}: ${error.message}`);
    }
    if (!data || data.length === 0) return;
    const { error: removeError } = await bucket.remove(data.map((file) => `${userId}/${file.name}`));
    if (removeError) throw new Error(`${bucketName}: ${removeError.message}`);
    if (data.length < 100) return;
  }
}
