import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { parseTxnQuery, queryTransactions } from "@/server/queries/transactions";
import { TransactionsView } from "@/components/transactions/transactions-view";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const q = parseTxnQuery(await searchParams);
  const [result, tags, reviewCount, allCount] = await Promise.all([
    queryTransactions(user.id, q, user.prefs.timezone, user.prefs),
    db.tag.findMany({ where: { userId: user.id }, select: { name: true }, orderBy: { name: "asc" } }),
    db.transaction.count({ where: { userId: user.id, deletedAt: null, needsReview: true } }),
    db.transaction.count({ where: { userId: user.id, deletedAt: null } }),
  ]);
  return <TransactionsView query={q} result={result} tags={tags.map((t) => t.name)} reviewCount={reviewCount} hasAny={allCount > 0} />;
}
