# Savor Privacy Policy

Last updated: 12.11.2026

Savor is a private journal. Nothing you keep in it is posted or shown to other people. This page explains what Savor stores, where, who can access it, and how to have it deleted.

Savor is made by Miri Yoo, an independent developer in Lausanne, Switzerland. Contact: miri.yoo.dev@gmail.com

## What Savor stores

**On your phone.** Your moments (words, kind, date and photos) and your letters are kept on your device, so Savor works without a connection.

**In your account, if you create one.** To keep your moments safe and on all your devices, Savor stores:

- Your email address and a password. Passwords are handled by Amazon Cognito; Savor never sees or stores your password.
- Your moments: their words, kind and dates.
- Your photos, as smaller copies made on your phone before upload. Location and other hidden photo information (EXIF metadata) is removed on your phone before upload. Your original photos stay on your phone.
- Whether the monthly letter is on, and your time zone, so months follow your calendar.
- Your letters.

**Technical logs.** The servers keep short-lived logs for running and fixing the service, such as when a request happened and whether it succeeded. They never contain the words of your moments or letters. They are deleted after 14 days.

**What Savor does not do.** No ads, no tracking, no analytics or advertising tools, no selling or sharing of your data, and no social features.

## The monthly letter

The monthly letter is off unless you turn it on. When it is on, once a month the words, kinds and dates of that month's moments are sent to an AI model, Claude by Anthropic, through Amazon Bedrock, to write your letter. Photos, your email and your account details are never sent.

The request is processed only in AWS regions in the European Union. Under Amazon Bedrock's terms, your moments and letters are not used to train models and are not shared with Anthropic. The letter is stored in your account so you can read it on your devices.

You can turn the letter off at any time on the Account screen. Letters already written stay until you delete your account.

## Where your data is stored

- Amazon Web Services (AWS), in Frankfurt, Germany: sign-in (Amazon Cognito), the app's servers (AWS Lambda), photos (Amazon S3), and letter writing (Amazon Bedrock, in EU regions).
- Neon, a database service running on AWS in Frankfurt, Germany: your moments, letters and settings.

Data travels encrypted (HTTPS) and is stored encrypted by these providers. Savor's data is not end-to-end encrypted, which means that, as the operator, I could technically access it. I only do so when needed to run or fix the service, or when the law requires it.

If you test Savor through Apple TestFlight, Apple may collect crash reports and the feedback you choose to send, under Apple's own privacy policy.

## How long data is kept

- Your data is kept for as long as you have an account.
- When you delete a moment, its words and photos are removed from your account and your other devices. A small record without any content stays, so your other devices learn that it was deleted.
- When you delete your account, everything is deleted: your sign-in, moments, photos, letters and settings.

## Deleting your account

[Until account deletion is available in the app: Email miri.yoo.dev@gmail.com from the address of your account, and your account and all its data will be deleted within 30 days.]

[Once available: In Savor, open the Account screen and choose "Delete account". This permanently deletes your sign-in, moments, photos, letters and settings.]

## Your rights

Under Swiss data protection law and, where it applies, the EU's GDPR, you can ask to see the data Savor holds about you, correct it, receive a copy of it, or have it deleted. Write to miri.yoo.dev@gmail.com. You can also contact the Swiss Federal Data Protection and Information Commissioner (FDPIC) or your local data protection authority.

## Children

Savor is not intended for children under 16.

## Changes

If this policy changes, the new version will be posted here with a new date. Significant changes will also be mentioned in the app.