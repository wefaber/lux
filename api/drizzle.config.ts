import { defineConfig } from "drizzle-kit";
import { databaseUrl, loadEnv } from "./src/env";

loadEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl() },
  strict: true,
  verbose: true,
});
