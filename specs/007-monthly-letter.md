# 007: The monthly letter

Status: done

## Problem

Savor helps a person notice moments as they happen. Looking back is half of savoring, but a timeline of single moments doesn't show what a month felt like. Once a month, Savor can write the person a short letter gathering what they kept: an LLM feature in the spirit of the compass, which helps them notice and never judges. Follows ADR 0007.

## Principles

- Opt-in. Off by default, explained in plain words before it's turned on.
- The letter stays close to the person's own words. It never judges, ranks, counts, advises or invents.
- No letter is not a failure. A quiet month simply has no letter, with no message about it.
- Only the month's moments (date, kind, words) are sent to the model. Never photos, email or ids.

## Behavior

### Turning it on

1. The Account screen, when signed in, shows "Monthly letter" with a switch, off by default.
2. Turning it on first shows a short explanation: once a month Savor writes a letter from that month's moments; to do this, the words, kinds and dates of those moments are sent to an AI model (Claude, through Amazon Bedrock in the EU); photos and account details are not; you can turn it off any time.
3. "Turn on" confirms. The phone's time zone is saved with the setting, so months follow the person's calendar.
4. Turning it off stops future letters. Existing letters stay.

### Writing letters

5. On the 1st of each month, the server writes a letter for each person who has it turned on and kept at least 3 moments (not deleted) in the previous calendar month, in their time zone.
6. A month's letter is written only once that month has ended in the person's time zone. At the 1st's run, a person behind Zurich (in Hawaii, say) may still be in the last day of the month; their letter is written on the 2nd.
7. Each person gets at most one letter per month. If writing fails, it's retried on the 2nd and 3rd; after that the month is skipped.
8. The letter is in English, 120 to 250 words, addressed to "you", and signed "Savor".

### Reading letters

9. A third tab, "Letters", lists letters newest first by month ("October 2026").
10. Opening one shows the letter on a warm page in the serif type, like a letter.
11. Letters are cached on the phone and readable offline. They are fetched when the Letters tab opens and after each sync.
12. Without any letters, the tab says one quiet line: "At the start of each month, a letter from your moments will arrive here." If the setting is off, it adds where to turn it on.
13. Signed out, the tab explains that letters need an account.

## The letter's voice (prompt rules)

- Warm, simple, unhurried. Like a friend who was paying attention. No greeting: it begins with the month.
- Built from the moments' own words and details, with names, titles and places as written; it may group them by feeling or theme.
- Never: judgement, praise of productivity, verdicts on what matters or praise for showing up, commentary or history the moments don't give, counts or statistics, comparisons with other months, advice, goals, or anything not in the moments.
- Moments are passed to the model as data inside clear delimiters, with an instruction to treat their content only as material for the letter.
- A letter that fails basic checks (empty, outside 80–350 words, or contains the delimiter text) is not saved and counts as a failure.

## Server

Data (Postgres, new migration):

- `letter_settings`: `user_id` primary key, `enabled` boolean, `time_zone` text (IANA), `updated_at`.
- `letters`: `id` uuid, `user_id`, `month` text (`YYYY-MM`), `body` text, `model` text, `input_tokens`, `output_tokens`, `created_at`. Unique on (`user_id`, `month`).

API (protected):

- `letters.getSettings()` → `{ enabled, timeZone }`
- `letters.setSettings({ enabled, timeZone })` (time zone validated as IANA)
- `letters.list()` → the caller's letters, newest first

Letter job:

- A second Lambda, `savor-letters`, from the same image with a different handler. Timeout 5 minutes.
- EventBridge Scheduler at 08:00 Europe/Zurich on days 1, 2 and 3 of each month.
- The month is the one before the run date in Europe/Zurich, or one passed in the event for a manual run.
- For each enabled user without a letter for that month, once it has ended in their time zone: load that month's moments (by the user's time zone), skip if fewer than 3, write the letter through `LetterWriter`, check it, save it.
- One user's failure is logged and doesn't stop the others. Saving relies on the unique constraint, so a rerun never duplicates.
- Caps: at most 150 moments per letter (the most recent), each moment's text cut at 1000 characters, `max_tokens` around 800.
- Logs record user count, letters written, skips, failures and token totals, never moment text or letter bodies.

Infrastructure (Terraform, `infra/app`):

- The letters Lambda and its log group (14 days).
- Its IAM role: logs, the database secret, and `bedrock:InvokeModel` on the chosen inference profile and its models only.
- The schedule and its role, allowed to invoke only the letters Lambda.
- Model id as a variable.
- The deploy role may update the letters function's code too.

## Phone

- Letters tab and letter screen, with the empty and signed-out states above.
- Monthly letter switch and explanation on the Account screen.
- A `letters` table in SQLite as a read-only cache (id, month, body, created_at), replaced from `letters.list`, and cleared on sign-out so another account never sees it.

## Development tools

- `pnpm --filter @savor/api letter-preview --month YYYY-MM`: writes a letter for the smoke user's moments (or a JSON file of sample moments) through the real model and prints it, without saving. For tuning the prompt by reading real output. Run by the developer with their own AWS credentials.

## Acceptance criteria

Opt-in

- [x] Given I'm signed in, the Account screen shows the monthly letter switch, off. Verified: monthly-letter-setting tests (off when signed in, hidden until known, not offered signed out); `letters.getSettings` test; manual run on a simulator and an iPhone.
- [x] Given I turn it on, I see the explanation first, and only "Turn on" enables it, saving my time zone. Verified: monthly-letter-setting tests (explains first, Turn on saves the phone's time zone, Not now changes nothing, no time zone changes nothing); `letters.setSettings` test; manual run on a simulator and an iPhone.
- [x] Given I turn it off, no new letters are written, and existing ones stay. Verified: job test "writes no letter when letters are off"; `letters.list` test "keeps the letters after letters are turned off", which fails when turning letters off deletes them; monthly-letter-setting test turning letters off at once.

Writing

- [x] Given letters on, and 3 or more moments last month in my time zone, then the job writes exactly one letter for that month. Verified: job test "writes exactly one letter for a month with 3 moments"; manual invoke for 2026-10 on 2026-11-04 wrote the letter that arrived on the phone.
- [x] Given fewer than 3 moments, or letters off, then no letter is written and nothing is shown about it. Verified: job tests (fewer than 3 moments; letters off or never on); Letters tab tests (one quiet line, never counts letters or moments).
- [x] Given moments near midnight at a month boundary, they're counted in the month of my time zone. Verified: job test "counts moments near midnight in the month of the person's time zone".
- [x] Given the month hasn't ended yet in my time zone when the job runs, then no letter is written until a later run. Verified: job test "waits until the month has ended in the person's time zone".
- [x] Given the job runs again (day 2 or 3, or a manual rerun), then no second letter is written. Verified: job test "never writes a second letter for the same month"; the unique (user, month) constraint test.
- [x] Given writing fails for one user, then other users still get theirs, and the failed one is retried on the next run. Verified: job test with one thrown error and one failed check among three users; both are written on the next run.
- [x] Given deleted moments, they're never sent to the model. Verified: job test "never sends deleted moments, other months' or other people's"; mutation check below.
- [x] The model receives only dates, kinds and words of that user's moments for that month: checked by a test on the exact request built. Verified: prompt tests (the exact request for each model; only date, kind and words, with ids, email and photo names absent); job test on what the writer receives.
- [x] A letter outside the checks (empty, too short or long, contains the delimiters) is not saved. Verified: `checkLetter` tests for each reason (malformed, refusal, truncated, stopped, empty, too short, too long, delimiter); job test that a failed check stores nothing.
- [x] Logs contain no moment text and no letter body. Verified: job test "logs counts and token totals, never a moment's words or a letter"; failures log the error's name only.

Reading

- [x] Given letters, the Letters tab lists them newest first, and each opens as a letter. Verified: Letters tab and letter screen tests; letters-store and `letters.list` ordering tests; manual run on a simulator and an iPhone.
- [x] Given no connection, previously fetched letters still open. Verified: Letters tab test without a connection; provider test keeping letters when the server can't be reached. Manual run on 2026-11-05: with the app already loaded and Wi-Fi off, the Letters tab and a letter opened from the cache. A cold start offline can't be tried with a development build, which loads its JavaScript from the dev server; recheck it with the TestFlight build.
- [x] Given no letters, or signed out, the tab shows its quiet line. Verified: Letters tab tests (no letters, letters off, signed out).
- [x] Given I sign out, the cached letters are removed from the phone. Verified: provider tests (removed on sign-out, including a fetch in flight at sign-out); letters-store test.
- [x] User B can never get user A's letters or settings. Verified: `letters.list` and `letters.setSettings` tests for other users; all three procedures refuse calls without a signed-in user.

Security and infrastructure

- [x] The letters Lambda can invoke only the configured model, and the API Lambda can't invoke Bedrock at all. Verified: IAM policy simulator on 2026-11-04 (README checks, now in docs/operations.md): the EU profile and its model through the profile allowed; the model directly, the global profile, and the API role denied.
- [x] The schedule can invoke only the letters Lambda. Verified: policy review; the schedule role's only statement is `lambda:InvokeFunction` on the letters function's ARN (`infra/app/letters.tf`). Not simulated.
- [x] Terraform fmt and validate pass; plan shows no changes after apply. Verified: fmt and validate in CI on every push; `terraform plan` on `infra/app` showed no changes on 2026-11-05.

Quality

- [x] Job tests on Postgres with a fake `LetterWriter`: thresholds, time zones, idempotency, failures, caps. Verified: `apps/api/src/letters/job.test.ts`.
- [x] The prompt is built by a pure function, tested for its rules and for the data it includes and leaves out. Verified: `apps/api/src/letters/prompt.test.ts`.
- [x] Mutation check: removing the user filter or the deleted-moment filter in the job's query makes a test fail. Verified: removing the user, deleted, month start or month end filter each failed a job test; so did removing the user filter in `letters.list` and the provider's in-flight guard.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass locally and in CI, and the iOS export passes. Verified: each commit checked on its own locally, iOS export included; CI on every push.

Manual

- [x] Run `letter-preview` on real moments, read the letter, and adjust the prompt until it sounds right. Verified: three runs on sample moments with Haiku 4.5; the prompt was adjusted twice (no greeting, names as written, no verdicts; no commentary or repeated phrases). Real moments were read in the letter on the iPhone. Reread after switching to Sonnet 5.5.
- [x] Invoke the letters Lambda once by hand for the previous month and see the letter arrive in the Letters tab on a simulator. Verified: invoked for 2026-10 on 2026-11-04 with seeded moments for the smoke user; the letter arrived on a simulator, and later on an iPhone.

## Out of scope

- Letters in French or other languages (someday)
- Push notifications when a letter arrives
- Deleting or regenerating a letter
- Photos in letters
- Letters for periods other than a calendar month

## Open questions

- None once ADR 0007 is accepted. If Bedrock can't be used, the plan switches to the Anthropic API with a key in Secrets Manager, set by the developer outside Terraform so it never lands in state, and stops to confirm first.
