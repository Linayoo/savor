import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import * as schema from "./schema";

export const db = drizzle(openDatabaseSync("savor.db"), { schema });
