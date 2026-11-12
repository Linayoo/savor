-- Deleted moments keep no words (spec 003, ADR 0005). Deletes clear them from
-- now on; this clears the tombstones kept before.
UPDATE `moments` SET `text` = '', `kind` = NULL WHERE `deleted_at` IS NOT NULL AND (`text` <> '' OR `kind` IS NOT NULL);
