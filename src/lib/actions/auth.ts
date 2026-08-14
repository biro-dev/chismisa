"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession, deleteSession, getSession } from "@/lib/session";

export type AuthState = {
  error?: string;
  success?: boolean;
};

export async function loginAction(
  _prevState: AuthState | undefined,
  formData: FormData
): Promise<AuthState> {
  const username = (formData.get("username") as string)?.trim();
  const password = (formData.get("password") as string) || "";

  if (!username || !password) {
    return { error: "Username and password are required." };
  }

  if (username.length < 3 || username.length > 20) {
    return { error: "Username must be between 3 and 20 characters." };
  }

  if (password.length < 4) {
    return { error: "Password must be at least 4 characters." };
  }

  try {
    // Check if user exists
    let user = await db.user.findUnique({ where: { username } });

    if (!user) {
      // Auto-register new user
      const hashedPassword = await bcrypt.hash(password, 10);
      try {
        user = await db.user.create({
          data: { username, password: hashedPassword },
        });
      } catch (err) {
        // Handle race condition: another request created this user first
        const prismaErr = err as { code?: string };
        if (prismaErr.code === "P2002") {
          user = await db.user.findUnique({ where: { username } });
          if (!user) throw err;
          const valid = await bcrypt.compare(password, user.password);
          if (!valid) {
            return { error: "Invalid credentials. Wrong password for this username." };
          }
        } else {
          throw err;
        }
      }
    } else {
      // Verify password
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return { error: "Invalid credentials. Wrong password for this username." };
      }
    }

    await createSession(user.id, user.username);
    return { success: true };
  } catch (err) {
    console.error("Login error:", err);
    return { error: "Something went wrong. Please try again." };
  }
}

export async function logoutAction() {
  await deleteSession();
  redirect("/login");
}

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}