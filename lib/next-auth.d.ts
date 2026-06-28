/* eslint-disable @typescript-eslint/no-unused-vars */
// types/next-auth.d.ts
import NextAuth, { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: number;
      username: string | null;
      email: string | null;
      avatarUrl: string | null;
      createdAt: Date;
      permissions: Record<string, number>; // Permission key -> value (0-255)
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: number;
    username?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
    createdAt?: Date;
    permissions?: Record<string, number>;
  }
}
