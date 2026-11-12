# Someday

- French phrases as moments
- Audio recordings
- Short video clips
- Films via TMDB (poster, year, director)
- Refresh-token rotation, so a session lasts 30 days from the last use instead of 30 days from sign-in (needs checking that Amplify handles rotated tokens)
- Neon's connection URLs with `sslmode=verify-full` instead of `require`, so pg v9 doesn't quietly weaken the TLS check (pg already warns about it, for example in `backfill-photo-sizes`)
