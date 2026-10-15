import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about Finora's custom type scale so `text-meta` isn't mistaken for a colour.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["display", "title", "section", "meta"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string | null | undefined, email?: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@._()-]+/).filter((w) => /^\p{L}/u.test(w));
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
