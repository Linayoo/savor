import { createDb } from "./db/client";
import { migrateDatabase } from "./db/migrate";
import { createServer } from "./server";

// `pnpm --filter @savor/api dev`: the local database from docker-compose.yml
const url =
  process.env.DATABASE_URL ?? "postgres://savor:savor@localhost:5433/savor";
const port = Number(process.env.PORT ?? 3000);

await migrateDatabase(url);
const { db } = createDb(url);
createServer(db).listen(port);
console.log(`Savor API on http://localhost:${port}`);
