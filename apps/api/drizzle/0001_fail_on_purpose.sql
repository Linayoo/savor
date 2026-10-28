DO $$ BEGIN
  IF current_database() <> 'savor_test' THEN
    RAISE EXCEPTION 'deliberate failure: checking that a failed migration stops the deploy';
  END IF;
END $$;
