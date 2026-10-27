import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import * as schema from "./schema";
import type { AppDb } from "./types";

export const db: AppDb = drizzle(openDatabaseSync("savor.db"), { schema });
