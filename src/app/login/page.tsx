import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[20px] bg-surface-raised shadow-lg shadow-black/30">
            <span className="text-3xl">🫢</span>
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink-text">
            Chismisa
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Anonymous real-time group chat. Create a group, share the code, and
            start chismisan! 🫢
          </p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-ink-muted">
          New here? Just pick a username and a password of at least 8
          characters — your account gets created automatically.
        </p>
      </div>
    </div>
  );
}