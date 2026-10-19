import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseUrl } from "../env";
import * as schema from "./schema";

export const pool = new Pool({ connectionString: databaseUrl(), max: 10 });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
