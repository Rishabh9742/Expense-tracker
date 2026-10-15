"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Notice } from "@/components/finance/primitives";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { registerAction } from "../actions";

function guessCurrency(tz: string): string {
  if (tz.startsWith("Asia/Kolkata") || tz.startsWith("Asia/Calcutta")) return "INR";
  if (tz.startsWith("Europe/London")) return "GBP";
  if (tz.startsWith("Europe/")) return "EUR";
  if (tz.startsWith("Australia/")) return "AUD";
  if (tz.startsWith("Asia/Singapore")) return "SGD";
  if (tz.startsWith("Asia/Tokyo")) return "JPY";
  if (tz.startsWith("America/Toronto") || tz.startsWith("America/Vancouver")) return "CAD";
  if (tz.startsWith("America/")) return "USD";
  return "INR";
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, undefined);
  const [tz, setTz] = useState("UTC");
  const [currency, setCurrency] = useState("INR");
  useEffect(() => {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTz(z);
    setCurrency(guessCurrency(z));
  }, []);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="mt-7 space-y-4" noValidate>
      <input type="hidden" name="timezone" value={tz} />
      {state?.error && <Notice tone="negative">{state.error}</Notice>}
      <Field label="Name" htmlFor="name" error={fe.name}>
        <Input id="name" name="name" autoComplete="name" required aria-invalid={!!fe.name} />
      </Field>
      <Field label="Email" htmlFor="email" error={fe.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!fe.email} />
      </Field>
      <Field label="Password" htmlFor="password" error={fe.password} hint="At least 10 characters, with a letter and a number.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!fe.password} />
      </Field>
      <Field label="Base currency" htmlFor="baseCurrency" hint={`Totals are converted into this currency. Time zone: ${tz}`}>
        <NativeSelect id="baseCurrency" name="baseCurrency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {SUPPORTED_CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        Create account
      </Button>
    </form>
  );
}
