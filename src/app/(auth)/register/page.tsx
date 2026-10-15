import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  if ((await auth())?.user) redirect("/");
  return (
    <>
      <h1 className="text-title font-semibold">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Start with a clean slate — no sample data is added to your account.</p>
      <RegisterForm />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
