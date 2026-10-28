import { migrateDatabase } from "../src/db/migrate";

// `pnpm --filter @savor/api db:migrate`: applies the checked-in migrations to
// DATABASE_URL. Deploys pass Neon's direct url, since its pooler runs in
// transaction mode.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

await migrateDatabase(url);
console.log("Migrations applied");
