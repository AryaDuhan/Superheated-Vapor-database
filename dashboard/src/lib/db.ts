import { Pool } from "pg";

const globalForPg = globalThis as unknown as { steamPool?: Pool };

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!globalForPg.steamPool) {
    globalForPg.steamPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 5,
    });
  }
  return globalForPg.steamPool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}
