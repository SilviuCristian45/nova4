"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BrandMark } from "@/app/components/brand-mark";
import { Text } from "@/app/components/language-provider";
import { Button, Card, CardTitle, Eyebrow, Field, Input, Message } from "@/app/components/ui";
import { loginUser } from "./action";

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleAction(formData: FormData) {
    setIsPending(true);
    setError(null);

    const result = await loginUser(formData);

    if (result?.error) {
      setError(result.error);
      setIsPending(false);
    } else {
      router.push(safeNextPath(searchParams.get("next")));
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center gap-6 px-5 py-10 text-foreground">
      <div className="flex flex-col gap-2">
        <BrandMark size="lg" />
        <div className="mt-2 flex flex-col gap-1">
          <Eyebrow>RepLog OS</Eyebrow>
          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.035em]">
            <Text ro="Bine ai revenit" en="Welcome back" />
          </h1>
          <p className="text-[13.5px] text-muted">
            <Text ro="Fiecare set contează. Depășește-te la fiecare sesiune." en="Track every set. Beat every session." />
          </p>
        </div>
      </div>

      <Card>
        <CardTitle description={<Text ro="Introdu credențialele pentru a continua" en="Enter your credentials to continue" />}>
          <Text ro="Autentificare" en="Sign in" />
        </CardTitle>
        <form action={handleAction} className="flex flex-col gap-3.5">
          <Field label={<Text ro="E-mail" en="Email" />} htmlFor="email">
            <Input id="email" name="email" type="email" required autoComplete="email" placeholder="name@example.com" />
          </Field>
          <Field label={<Text ro="Parolă" en="Password" />} htmlFor="password">
            <Input id="password" name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
          </Field>
          {error && <Message>{error}</Message>}
          <Button type="submit" busy={isPending} className="mt-1 w-full">
            {isPending ? <Text ro="Se autentifică..." en="Signing in..." /> : <Text ro="Autentificare" en="Sign in" />}
          </Button>
        </form>
      </Card>

      <p className="text-center text-[13.5px] text-muted">
        <Text ro="Nu ai un cont?" en="Don't have an account?" />{" "}
        <Link href="/register" className="font-semibold text-lime-text transition-opacity hover:opacity-80">
          <Text ro="Creează unul" en="Create one" />
        </Link>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
