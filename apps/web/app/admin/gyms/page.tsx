import { redirect } from "next/navigation";
import { getSessionUser, serverApi } from "@/lib/api/server";
import type { ApiAdminGym } from "@/lib/api/gym-types";
import { AdminGymsClient } from "./admin-gyms-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminGymsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.isSuperAdmin) redirect("/");

  const gyms = await serverApi<ApiAdminGym[]>("/admin/gyms").catch(() => []);
  return <AdminGymsClient initialGyms={gyms} />;
}
