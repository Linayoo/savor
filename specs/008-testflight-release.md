# 008: TestFlight release

Status: approved

## Problem

Savor only runs as a development build, which loads its JavaScript from the developer's Mac and can't open on its own. This spec ships Savor as a real iOS app through TestFlight: a release build with everything inside, built and uploaded by an automated pipeline from a version tag, installed on the developer's own iPhone. It completes M5's first half; the demo video and README polish follow.

## Principles

- A release is a tag, not a manual build: pushing `mobile-v1.0.0` produces a TestFlight build, after the same checks as every commit.
- The development app and the release app live side by side on one phone, so testing never risks real moments.
- The release app contains no development tooling and no development logs.
- Only internal testing in this spec. Nothing goes to App Review.

## App identity

- Display name on the home screen: Savor.
- App Store Connect name: "Savor: Moments" (plain "Savor" may be taken; the home screen name can still be "Savor").
- Bundle identifier: `com.linayoo.savor` for the release app.
- Version `1.0.0`; build numbers managed by EAS and incremented automatically.
- App icon: the Sparkle (Ivory) in `apps/mobile/assets/icon/`: `savor-icon.png` as the main icon, opaque (App Store requirement), and `savor-icon-dark.png` and `savor-icon-tinted.png` on transparent backgrounds for the dark and tinted home screen; SVG sources beside them.
- Launch screen in the app's warm background color, `#F6F1E8`, with no text: the background alone if it renders, otherwise the small Sparkle mark on it.
- Permission prompts, in plain words:
  - Camera: "Savor uses the camera so you can add a photo to a moment."
  - Photo library: "Savor uses your photo library so you can add photos to a moment."
- Export compliance: Savor uses only standard HTTPS, so `ITSAppUsesNonExemptEncryption` is false and App Store Connect doesn't ask on every upload.

## Two app variants

- `app.json` becomes `app.config.ts`, reading `APP_VARIANT`:
  - `development`: name "Savor Dev", bundle identifier `com.linayoo.savor.dev`, includes the development client.
  - `production` (default): name "Savor", bundle identifier `com.linayoo.savor`.
- Both can be installed on one iPhone at once, with separate data.
- Local commands set `APP_VARIANT=development` (`pnpm mobile`, `pnpm ios`), so a local build is always "Savor Dev".
- The simulators' current development builds keep working after one rebuild; their data stays with the dev bundle identifier from the next build on (acceptable: test data).
- An iPhone's current development build uses `com.linayoo.savor`, the release identifier. Installing from TestFlight would replace it and keep its data, so first rebuild it as "Savor Dev", then delete the old app.

## Build and upload

- Expo Application Services (EAS): `eas.json` with `development` and `production` profiles.
- `production`: store distribution, remote app version with automatic build number increments, environment `production`.
- App configuration (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_USER_POOL_ID`, `EXPO_PUBLIC_USER_POOL_CLIENT_ID`) stored as EAS environment variables for `production`, not in the repo.
- EAS Submit uploads the build to App Store Connect using an App Store Connect API key stored in EAS (not in GitHub).
- Signing certificates and provisioning profiles managed by EAS.

## Release workflow (GitHub Actions)

- `.github/workflows/release-mobile.yml`, triggered by a tag `mobile-v*`.
- Steps: install, typecheck, lint, format check, tests; check that the tag's version equals the app's version; then `eas build --platform ios --profile production --auto-submit --non-interactive`, waiting for the result.
- Secret: `EXPO_TOKEN` (an Expo robot access token), the only secret this workflow uses. No AWS or Apple keys in GitHub.
- The build's TestFlight "What to Test" note is written by hand in App Store Connect; EAS sends it only on its Enterprise plan. Tags may be annotated, as release notes in git, but don't have to be.
- README and project descriptions that say "no stored keys" are corrected to "no AWS keys stored in GitHub", since the Expo token is a stored secret.

## Release behavior checks

- `[auth]` and `[sync]` development logs are absent from the release build.
- The release build talks to the production API and user pool.
- The release build opens with no network, shows cached moments and letters, and syncs when the network returns.
- A first launch starts signed out, even when the Keychain holds tokens from an earlier install: the iOS Keychain outlives the app. A marker in app storage tells a first launch apart; the first TestFlight install of 1.0.0 started signed in, and 1.0.1 fixes it. Installs from before 1.0.1 are signed out once when they update.

## Acceptance criteria

Pipeline

- [x] Pushing tag `mobile-v1.0.0` runs the checks, builds, and uploads a build that appears in TestFlight without any manual step. Verified: `mobile-v1.0.0` (build 3) and `mobile-v1.0.1` (build 4) ran the checks, built on EAS and reached the Internal group with nothing done by hand. The first 1.0.0 run failed on unset credentials, then on `--what-to-test`, which EAS allows only on its Enterprise plan; the workflow no longer sends it.
- [x] A tag whose version doesn't match the app's version fails before building. Verified: the version step, run in a throwaway clone, fails for a mismatched tag; `release` needs it, so nothing builds. Not exercised by pushing a wrong tag.
- [x] A failing check stops the release before building. Verified: `release` needs the `check` job, the same reusable workflow as CI. Not exercised with a failing check.
- [x] `EXPO_TOKEN` is the workflow's only secret; no Apple or AWS credentials are stored in GitHub. Verified: `release-mobile.yml` reads only `secrets.EXPO_TOKEN`; signing and the App Store Connect key live in EAS.

App

- [x] Savor installs from TestFlight on my iPhone, next to "Savor Dev", with separate data. Verified: 1.0.1 on the iPhone beside Savor Dev. 1.0.0 started signed in from Keychain tokens of the deleted development build; 1.0.1 clears them on first launch (fresh-install tests).
- [x] The home screen shows "Savor" with the correct icon; the launch screen shows no text. Verified on the iPhone, light, dark and tinted.
- [x] Camera and photo library prompts show the wording above. Verified on the iPhone; no microphone prompt.
- [x] No export compliance question appears for the build in App Store Connect. Verified for builds 3 and 4.
- [x] I can create an account or sign in, keep moments with photos, and see them sync with a simulator. Verified on 1.0.1 against the production API and user pool.
- [x] The Letters tab shows letters for an account that has them. Verified on 1.0.1.
- [x] Cold start offline: with flight mode on, the app opens and shows my moments and cached letters; turning it off, they sync (carried over from spec 007). Verified on 1.0.1.
- [x] No development logs and no development menu in the release build. Verified on 1.0.1: no `[auth]` or `[sync]` logs; the production profile has no development client, so no menu.

Docs

- [x] README: how to release (tag, workflow, TestFlight), and the one-time setup in docs/operations.md. Verified: README "Releasing" and docs/operations.md "Releasing the iOS app".
- [x] The roadmap ticks "TestFlight via CI".

## One-time setup (developer)

- Apple Developer Program membership.
- App Store Connect app record (created): name "Savor: Moments", bundle ID com.linayoo.savor, SKU savor-ios, primary language English (U.S.).
- App Store Connect API key with the App Manager role, uploaded to EAS.
- Expo account and project, linked with `eas init`.
- Expo robot access token saved as the GitHub secret `EXPO_TOKEN`.
- Myself as internal tester in TestFlight.

## Out of scope

- External testers, Beta App Review and a privacy policy page
- App Store release and App Review
- Account deletion in the app (required before App Store release; its own spec)
- Android builds
- Over-the-air updates
- Crash reporting

## Open questions

- "Savor: Moments" for App Store Connect, decided when creating the app record.
