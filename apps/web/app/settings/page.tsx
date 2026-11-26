import { Text } from "@/app/components/language-provider";
import { redirect } from "next/navigation";
import { Columns, Screen, Stack } from "@/app/components/ui";
import { AccountForms, CoachRoleSection, DangerZone, DataPortability, ProfileForm } from "./settings-forms";
import { DriveBackupSection, type DriveStatus } from "./drive-backup";
import { isCoachSelfServeEnabled } from "@/lib/coach/auth";
import { getSessionUser, serverApi } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ drive?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = user.profile;
  const role = profile?.role ?? "client";
  const coachProfile = user.coachProfile;
  const allowCoachSelfServe = isCoachSelfServeEnabled();

  let drive: DriveStatus | null = null;
  try {
    const status = await serverApi<DriveStatus & { configured?: boolean }>("/drive/status");
    if (status.configured) {
      drive = {
        connected: status.connected,
        email: status.email,
        frequency: status.frequency,
        lastBackupAt: status.lastBackupAt,
        lastError: status.lastError,
      };
    }
  } catch (error) {
    console.error("Drive status unavailable:", error);
  }
  const { drive: connectResult } = await searchParams;

  return (
    <Screen title={<Text ro="Setări" en="Settings" />}>
      <Columns>
        <Stack>
          <ProfileForm
            profile={{
              displayName: profile?.displayName ?? "",
              heightCm: profile?.heightCm?.toString() ?? "",
              birthDate: profile?.birthDate ?? "",
              sex: profile?.sex ?? "",
              weightUnit: profile?.weightUnit ?? "kg",
              dailyStepsGoal: profile?.dailyStepsGoal ?? 10000,
            }}
          />
          {(role === "coach" || allowCoachSelfServe) && (
            <CoachRoleSection
              role={role}
              migrationMissing={false}
              defaultDisplayName={profile?.displayName ?? ""}
              coachProfile={
                coachProfile
                  ? {
                      displayName: coachProfile.displayName,
                      bio: coachProfile.bio ?? "",
                      specialties: coachProfile.specialties.join(", "),
                      isPublic: coachProfile.isPublic,
                      acceptingClients: coachProfile.acceptingClients,
                    }
                  : null
              }
            />
          )}
          <AccountForms email={user.email ?? ""} />
        </Stack>
        <Stack>
          <DataPortability />
          {drive && <DriveBackupSection initial={drive} connectResult={connectResult ?? null} />}
          <DangerZone email={user.email ?? ""} />
        </Stack>
      </Columns>
    </Screen>
  );
}
