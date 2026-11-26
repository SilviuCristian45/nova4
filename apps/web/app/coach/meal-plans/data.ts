import "server-only";
import { serverApi } from "@/lib/api/server";
import type { MealPlanDocument } from "@/lib/coach/meal-plans";

export type ActiveClientOption = {
  id: string;
  name: string;
};

interface ApiCoachClient {
  clientId: string;
  clientName: string | null;
  status: string;
}

export async function getCoachActiveClients(): Promise<ActiveClientOption[]> {
  const clients = await serverApi<ApiCoachClient[]>("/coach/clients").catch(() => []);
  const byId = new Map<string, string>();
  for (const c of clients) {
    if (c.status !== "active") continue;
    if (!byId.has(c.clientId)) {
      byId.set(c.clientId, c.clientName?.trim() || `Client #${c.clientId.slice(0, 6)}`);
    }
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCoachMealPlanById(
  planId: string,
  coachName: string,
): Promise<MealPlanDocument | null> {
  try {
    const plan = await serverApi<MealPlanDocument>(`/coach/meal-plans/${encodeURIComponent(planId)}`);
    return {
      ...plan,
      coachName: plan.coachName || coachName,
      assignedClientId: plan.assignedClientId ?? null,
      clientName: plan.clientName ?? null,
      shareToken: plan.shareToken ?? null,
    };
  } catch {
    return null;
  }
}
