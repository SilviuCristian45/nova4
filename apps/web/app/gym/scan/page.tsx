import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/api/server";
import { GymScanClient } from "./gym-scan-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GymScanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const initialCode = params.code ?? params.token ?? "";

  return <GymScanClient initialCode={initialCode} />;
}
