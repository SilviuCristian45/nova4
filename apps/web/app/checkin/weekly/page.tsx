import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { Text } from "@/app/components/language-provider";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { mondayOfWeek } from "@/lib/coach/interactions";
import { localDate } from "@/lib/daily-metrics";
import type { CheckinPhotoUrls, WeeklyCheckinWithPhotos } from "@/lib/coach/types";
import { Empty, Screen, buttonClass } from "@/app/components/ui";
import { WeeklyCheckinClient, type ActiveCoachOption } from "./weekly-checkin-client";

export const dynamic = "force-dynamic";

interface ApiEnrollment {
  id: string;
  coachId: string;
  coachName: string | null;
  programId: string | null;
  programTitle: string | null;
  status: string;
}

interface ApiWeeklyCheckin {
  id: string;
  clientId: string;
  coachId: string;
  enrollmentId: string | null;
  weekStart: string;
  weightKg: number | null;
  energy: number;
  sleep: number;
  stress: number;
  clientNotes: string | null;
  coachReply: string | null;
  reviewedAt: string | null;
  photoFrontPath: string | null;
  photoBackPath: string | null;
  photoSidePath: string | null;
  photoUrls?: CheckinPhotoUrls;
  createdAt?: string;
  updatedAt?: string;
}

export default async function WeeklyCheckinPage() {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const weekStart = mondayOfWeek(localDate());

  const [allEnrollments, weightRows, historyRows] = await Promise.all([
    serverApi<ApiEnrollment[]>("/explore/enrollments").catch(() => []),
    serverApi<{ date: string; weightKg: number }[]>("/metrics/weight").catch(() => []),
    serverApi<ApiWeeklyCheckin[]>("/checkins/weekly").catch(() => []),
  ]);

  const enrollments = allEnrollments.filter((e) => e.status === "active");
  if (enrollments.length === 0) {
    return (
      <Screen title={<Text ro="Check-in săptămânal" en="Weekly check-in" />}>
        <Empty icon={ClipboardCheck}>
          <Text
            ro="Check-in-ul săptămânal este disponibil când ai un antrenor activ."
            en="Weekly check-ins are available once you have an active coach."
          />
        </Empty>
        <Link href="/explore" className={buttonClass()}>
          <Text ro="Descoperă programe & antrenori" en="Browse programs & coaches" />
        </Link>
      </Screen>
    );
  }

  const byCoach = new Map<string, ActiveCoachOption>();
  for (const e of enrollments) {
    if (!byCoach.has(e.coachId)) {
      byCoach.set(e.coachId, {
        coachId: e.coachId,
        coachName: e.coachName ?? t("Antrenor", "Coach"),
        enrollmentId: e.id,
        programTitle: e.programTitle ?? null,
      });
    }
  }
  const coaches = [...byCoach.values()];

  const latestWeightRow = weightRows.length > 0 ? weightRows[weightRows.length - 1] : null;
  const latestWeightKg = latestWeightRow ? Number(latestWeightRow.weightKg) : null;

  const history: WeeklyCheckinWithPhotos[] = historyRows.map((r) => ({
    id: r.id,
    client_id: r.clientId,
    coach_id: r.coachId,
    enrollment_id: r.enrollmentId,
    week_start: r.weekStart,
    weight_kg: r.weightKg,
    energy: r.energy,
    sleep: r.sleep,
    stress: r.stress,
    client_notes: r.clientNotes,
    coach_reply: r.coachReply,
    reviewed_at: r.reviewedAt,
    photo_front_path: r.photoFrontPath,
    photo_back_path: r.photoBackPath,
    photo_side_path: r.photoSidePath,
    created_at: r.createdAt ?? r.weekStart,
    updated_at: r.updatedAt ?? r.weekStart,
    photoUrls: r.photoUrls ?? {},
  }));

  return (
    <Screen title={<Text ro="Check-in săptămânal" en="Weekly check-in" />}>
      <WeeklyCheckinClient
        userId={user.id}
        weekStart={weekStart}
        coaches={coaches}
        latestWeightKg={latestWeightKg}
        history={history}
      />
    </Screen>
  );
}
