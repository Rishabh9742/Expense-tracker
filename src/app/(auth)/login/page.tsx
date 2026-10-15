import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Notice } from "@/components/finance/primitives";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; deleted?: string }> }) {
  const sp = await searchParams;
  if ((await auth())?.user) redirect("/");
  let next = "/";
  try {
    if (sp.callbackUrl) next = new URL(sp.callbackUrl, "http://x").pathname;
  } catch {}
  return (
    <>
      <h1 className="text-title font-semibold">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Log in to your Finora workspace.</p>
      {sp.deleted === "1" && (
        <Notice tone="positive" className="mt-5">
          Your account and all of its data have been permanently deleted.
        </Notice>
      )}
      <LoginForm next={next} />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to Finora?{" "}
        <Link href="/register" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
