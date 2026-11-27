import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/theme-provider";
import { LanguageProvider } from "./components/language-provider";
import { getLanguage } from "./language";
import { getWeightUnit } from "./units";
import { UnitsProvider } from "./components/units-provider";
import { OfflineProvider } from "@/lib/offline/client";
import { DriveAutoSync } from "./components/drive-auto-sync";
import { ExerciseGifProvider } from "./components/exercise-gif";
import { AppShell } from "./components/app-shell";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { getCurrentAuthRole } from "@/lib/coach/auth";
import type { ApiMyGymsResponse } from "@/lib/api/gym-types";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getLanguage();
  return {
    title: {
      default: "RepLog",
      template: "%s · RepLog",
    },
    description: t(
      "Monitorizarea antrenamentelor, nutriției, progresului și coaching-ului",
      "Training, nutrition, progress and coaching operating system",
    ),
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "RepLog",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { language } = await getLanguage();
  const weightUnit = await getWeightUnit();

  let initialUnread = 0;
  let signedIn = false;
  let userName: string | null = null;
  let userEmail: string | null = null;
  let isCoach = false;
  let hasGymStaff = false;
  let isSuperAdmin = false;

  try {
    const user = await getSessionUser();
    if (user) {
      signedIn = true;
      userEmail = user.email ?? null;
      isSuperAdmin = Boolean(user.isSuperAdmin);
      const [authRole, unreadRes, gymMy] = await Promise.all([
        getCurrentAuthRole().catch(() => null),
        serverApi<{ count: number }>("/notifications/unread").catch(() => ({ count: 0 })),
        serverApi<ApiMyGymsResponse>("/gym/my").catch(() => ({ memberships: [], staffGyms: [] })),
      ]);
      userName = authRole?.displayName?.trim() || null;
      isCoach = authRole?.role === "coach";
      initialUnread = unreadRes.count ?? 0;
      hasGymStaff = (gymMy.staffGyms?.length ?? 0) > 0;
    }
  } catch {
    // Gracefully skip if unauthenticated or offline shell.
  }

  return (
    <html
      lang={language}
      suppressHydrationWarning
      className={`${jakarta.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <LanguageProvider initialLanguage={language}>
            <UnitsProvider initialUnit={weightUnit}>
              <OfflineProvider>
                <ExerciseGifProvider>
                  {signedIn && <DriveAutoSync />}
                  <AppShell
                    signedIn={signedIn}
                    userName={userName}
                    userEmail={userEmail}
                    isCoach={isCoach}
                    hasGymStaff={hasGymStaff}
                    isSuperAdmin={isSuperAdmin}
                    initialUnread={initialUnread}
                  >
                    {children}
                  </AppShell>
                </ExerciseGifProvider>
              </OfflineProvider>
            </UnitsProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
