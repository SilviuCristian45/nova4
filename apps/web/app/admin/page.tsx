import { redirect } from "next/navigation";
import { getSessionUser, serverApi } from "@/lib/api/server";
import type { ApiAdminUserListResponse } from "@/lib/api/types";
import { AdminUsersClient } from "./admin-users-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  if (!user.isSuperAdmin) {
    redirect("/");
  }

  const initialData = await serverApi<ApiAdminUserListResponse>("/admin/users").catch(() => ({
    stats: { total: 0, active: 0, disabled: 0, coaches: 0, clients: 0 },
    items: [],
  }));

  return <AdminUsersClient initialData={initialData} currentUserId={user.id} />;
}
