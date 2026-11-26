import { redirect } from "next/navigation";
import { Text } from "@/app/components/language-provider";
import { Message, Screen } from "@/app/components/ui";
import type { PhotoPose } from "@/lib/photos";
import { getSessionUser, serverApi } from "@/lib/api/server";
import PhotoGallery, { type GalleryPhoto } from "./photo-gallery";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ApiPhoto {
  id: string;
  takenOn: string;
  pose: PhotoPose;
  note: string | null;
  path: string;
  sizeBytes: number;
  url: string | null;
}

export default async function PhotosPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const title = <Text ro="Poze de progres" en="Progress photos" />;

  let rows: ApiPhoto[];
  try {
    rows = await serverApi<ApiPhoto[]>("/photos");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return (
      <Screen title={title}>
        <Message>
          <Text ro="Nu s-au putut încărca pozele:" en="Could not load the photos:" /> {message}
        </Message>
      </Screen>
    );
  }

  const photos: GalleryPhoto[] = rows
    .filter((row): row is ApiPhoto & { url: string } => Boolean(row.url))
    .map((row) => ({
      id: row.id,
      taken_on: row.takenOn,
      pose: row.pose,
      note: row.note,
      path: row.path,
      size_bytes: row.sizeBytes,
      url: row.url,
    }));

  return (
    <Screen title={title}>
      <PhotoGallery photos={photos} />
    </Screen>
  );
}
