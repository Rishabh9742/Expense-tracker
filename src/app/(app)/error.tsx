"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-xl bg-negative-soft text-negative">
        <AlertTriangle className="size-5" />
      </span>
      <h1 className="mt-4 text-section font-semibold">{offline ? "You're offline" : "This page couldn't load"}</h1>
      <p className="mt-2 text-[13.5px] text-muted-foreground">
        {offline
          ? "Check your connection and try again. Nothing you saved earlier was lost."
          : "Something went wrong while calculating this page. Your data is safe — no changes were made. Try again, and if it keeps happening, check that the database is reachable."}
      </p>
      {error.digest && <p className="mt-2 text-meta text-subtle-foreground">Reference: {error.digest}</p>}
      <Button variant="primary" className="mt-5" onClick={reset}>
        <RotateCcw /> Try again
      </Button>
    </Card>
  );
}
