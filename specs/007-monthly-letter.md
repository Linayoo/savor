# 007: The monthly letter

Status: approved

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
- Never: judgement, praise of productivity, verdicts on what matters or praise for showing up, counts or statistics, comparisons with other months, advice, goals, or anything not in the moments.
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

- [ ] Given I'm signed in, the Account screen shows the monthly letter switch, off.
- [ ] Given I turn it on, I see the explanation first, and only "Turn on" enables it, saving my time zone.
- [ ] Given I turn it off, no new letters are written, and existing ones stay.

Writing

- [ ] Given letters on, and 3 or more moments last month in my time zone, then the job writes exactly one letter for that month.
- [ ] Given fewer than 3 moments, or letters off, then no letter is written and nothing is shown about it.
- [ ] Given moments near midnight at a month boundary, they're counted in the month of my time zone.
- [ ] Given the month hasn't ended yet in my time zone when the job runs, then no letter is written until a later run.
- [ ] Given the job runs again (day 2 or 3, or a manual rerun), then no second letter is written.
- [ ] Given writing fails for one user, then other users still get theirs, and the failed one is retried on the next run.
- [ ] Given deleted moments, they're never sent to the model.
- [ ] The model receives only dates, kinds and words of that user's moments for that month: checked by a test on the exact request built.
- [ ] A letter outside the checks (empty, too short or long, contains the delimiters) is not saved.
- [ ] Logs contain no moment text and no letter body.

Reading

- [ ] Given letters, the Letters tab lists them newest first, and each opens as a letter.
- [ ] Given no connection, previously fetched letters still open.
- [ ] Given no letters, or signed out, the tab shows its quiet line.
- [ ] Given I sign out, the cached letters are removed from the phone.
- [ ] User B can never get user A's letters or settings.

Security and infrastructure

- [ ] The letters Lambda can invoke only the configured model, and the API Lambda can't invoke Bedrock at all.
- [ ] The schedule can invoke only the letters Lambda.
- [ ] Terraform fmt and validate pass; plan shows no changes after apply.

Quality

- [ ] Job tests on Postgres with a fake `LetterWriter`: thresholds, time zones, idempotency, failures, caps.
- [ ] The prompt is built by a pure function, tested for its rules and for the data it includes and leaves out.
- [ ] Mutation check: removing the user filter or the deleted-moment filter in the job's query makes a test fail.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass locally and in CI, and the iOS export passes.

Manual

- [ ] Run `letter-preview` on real moments, read the letter, and adjust the prompt until it sounds right.
- [ ] Invoke the letters Lambda once by hand for the previous month and see the letter arrive in the Letters tab on a simulator.

## Out of scope

- Letters in French or other languages (someday)
- Push notifications when a letter arrives
- Deleting or regenerating a letter
- Photos in letters
- Letters for periods other than a calendar month

## Open questions

- None once ADR 0007 is accepted. If Bedrock can't be used, the plan switches to the Anthropic API with a key in Secrets Manager, set by the developer outside Terraform so it never lands in state, and stops to confirm first.
