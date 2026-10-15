import { Skeleton } from "@/components/ui/misc";

/** Skeleton that mirrors the page layout (header, metric row, primary + side cards). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-6 w-32" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-12">
        <div className="rounded-xl border border-border bg-surface p-5 lg:col-span-8">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-6 h-56 w-full" />
        </div>
        <div className="rounded-xl border border-border bg-surface p-5 lg:col-span-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mx-auto mt-6 size-40 rounded-full" />
          <div className="mt-6 space-y-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-3.5 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
