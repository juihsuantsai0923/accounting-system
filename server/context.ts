import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { db } from "./db";
import { users } from "./schema";
import { eq } from "drizzle-orm";
import { verifyToken } from "./auth";

export async function createContext({ req }: CreateExpressContextOptions) {
  let user = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      const rows = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      if (rows[0] && rows[0].isActive) {
        user = rows[0];
      }
    }
  }
  return { db, user };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
