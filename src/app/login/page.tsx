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
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-fuchsia-600 shadow-lg shadow-purple-900/50">
            <span className="text-3xl">💬</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-purple-400 to-fuchsia-400 bg-clip-text text-transparent">
            Chismisa
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Anonymous real-time group chat. Create a group, share the code, and
            start chismisan! 🫢
          </p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-zinc-500">
          New here? Just pick a username and a password of at least 8
          characters — your account gets created automatically.
        </p>
      </div>
    </div>
  );
}