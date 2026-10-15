import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo />
      <h1 className="mt-8 text-title font-semibold">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist, or it belongs to someone else&apos;s account.</p>
      <Button asChild variant="primary" className="mt-6">
        <Link href="/">Back to Overview</Link>
      </Button>
    </main>
  );
}
