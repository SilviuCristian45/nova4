import Link from "next/link";
import { Utensils } from "lucide-react";
import { Text } from "@/app/components/language-provider";
import { getSessionUser, serverApi } from "@/lib/api/server";
import type { MealPlanDocument } from "@/lib/coach/meal-plans";
import { Empty, Screen, buttonClass } from "@/app/components/ui";
import { ClientMealPlanShell } from "./client-plan-shell";

export const dynamic = "force-dynamic";

export default async function ClientMealPlanPage() {
  const user = await getSessionUser();
  let plans: MealPlanDocument[] = [];

  if (user) {
    const clientName = user.profile?.displayName?.trim() || null;
    const raw = await serverApi<MealPlanDocument[]>("/meals/plan").catch(() => []);
    plans = raw.map((p) => ({
      ...p,
      assignedClientId: user.id,
      clientName,
      shareToken: null,
    }));
  }

  return (
    <Screen back="/meals" title={<Text ro="Plan alimentar" en="Meal plan" />}>
      {plans.length === 0 ? (
        <div className="flex flex-col items-center gap-4">
          <Empty icon={Utensils}>
            <Text
              ro="Nu ai încă un plan alimentar activ de la antrenorul tău. Când antrenorul îți asignează un plan, îl vei putea vedea aici, exporta în PDF și loga mesele cu 1 click."
              en="You don't have an active meal plan from your coach yet. Once your coach assigns one, you'll be able to view it here, export PDF, and log meals in 1 click."
            />
          </Empty>
          <Link href="/explore" className={buttonClass({ variant: "secondary", small: true })}>
            <Text ro="Vezi Programe & Antrenori" en="Browse Programs & Coaches" />
          </Link>
        </div>
      ) : (
        <ClientMealPlanShell plans={plans} />
      )}
    </Screen>
  );
}
