-- Deleted moments keep no words (spec 003, ADR 0005). Pushes clear them from
-- now on; this clears the tombstones stored before.
UPDATE "moments" SET "text" = '', "kind" = NULL WHERE "deleted_at" IS NOT NULL AND ("text" <> '' OR "kind" IS NOT NULL);
