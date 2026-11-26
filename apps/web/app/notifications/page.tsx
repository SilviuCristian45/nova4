import { redirect } from "next/navigation";
import { Text } from "@/app/components/language-provider";
import { getSessionUser, serverApi } from "@/lib/api/server";
import type { AppNotification } from "@/lib/coach/types";
import { Screen } from "@/app/components/ui";
import { NotificationsClient } from "./notifications-client";

export const dynamic = "force-dynamic";

interface ApiNotification {
  id: string;
  userId: string;
  actorId: string | null;
  type: AppNotification["type"];
  payload: Record<string, unknown>;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const rows = await serverApi<ApiNotification[]>("/notifications?limit=100").catch(() => []);
  const items: AppNotification[] = rows.map((n) => ({
    id: n.id,
    user_id: n.userId,
    actor_id: n.actorId,
    type: n.type,
    payload: n.payload,
    link: n.link,
    read_at: n.readAt,
    created_at: n.createdAt,
  }));

  return (
    <Screen title={<Text ro="Notificări" en="Notifications" />}>
      <NotificationsClient initialItems={items} />
    </Screen>
  );
}
