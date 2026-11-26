import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { Text } from "@/app/components/language-provider";
import { Empty, Screen, buttonClass } from "@/app/components/ui";
import { getSessionUser, serverApi } from "@/lib/api/server";
import type { ApiMyGymsResponse } from "@/lib/api/gym-types";
import { GymManageClient } from "./gym-manage-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GymManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const data = await serverApi<ApiMyGymsResponse>("/gym/my").catch(() => ({
    memberships: [],
    staffGyms: [],
  }));

  if (data.staffGyms.length === 0) {
    if (user.isSuperAdmin) {
      return (
        <Screen title={<Text ro="Administrare Sală" en="Gym Management" />} back="/">
          <Empty icon={Building2}>
            <Text ro="Nu există încă nicio sală creată." en="No gyms have been created yet." />
          </Empty>
          <div className="flex justify-center">
            <Link href="/admin/gyms" className={buttonClass()}>
              <Text ro="Creează prima sală" en="Create first gym" />
            </Link>
          </div>
        </Screen>
      );
    }
    redirect("/gym");
  }

  return <GymManageClient initialGyms={data.staffGyms} initialGymId={params.gymId} />;
}
