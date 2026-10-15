"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Notice } from "@/components/finance/primitives";
import { loginAction } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="mt-7 space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state?.error && <Notice tone="negative">{state.error}</Notice>}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        Log in
      </Button>
    </form>
  );
}
