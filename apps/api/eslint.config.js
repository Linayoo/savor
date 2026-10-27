import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["drizzle"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Dropping a field with { field: _, ...rest } is fine
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true },
      ],
    },
  },
);
