/* eslint-disable @typescript-eslint/no-unused-vars */
// types/next-auth.d.ts
import NextAuth from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: number;
      username: string | null;
      email: string | null;
      avatarUrl: string | null;
      isAdmin: boolean;
      createdAt: Date;
    };
  }

  interface User {
    id: number;
    username: string | null;
    email: string | null;
    avatarUrl: string | null;
    isAdmin: boolean;
    createdAt: Date;
  }
}
