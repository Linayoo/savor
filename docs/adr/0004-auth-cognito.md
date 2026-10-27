# 0004: Authentication with Amazon Cognito

Status: accepted
Date: 2026-10-27

## Context

Savor will have several users, each with private moments, on one or more devices.
The API must know who is calling and only return that user's data.

## Options considered

1. Amazon Cognito user pool
2. A hosted auth service (Clerk, Auth0, Supabase Auth)
3. Own email and password handling

## Decision

Option 1. A Cognito user pool with email and password sign-in, managed in Terraform.
The app signs in and keeps tokens on the device; the API verifies the JWT on every request and takes the user id from it.

## Consequences

- Stays inside AWS and Terraform, with a generous free tier.
- Every database query is scoped by the user id from the token, never by an id sent by the client.
- Email and password only at first. App Store guideline 4.8 adds a requirement if social sign-in comes later: the app must also offer an equivalent login. That login may collect only name and email, must let the user keep their email private, and must not track for ads without consent. Sign in with Apple is the usual way to meet it.
- Cognito's developer experience is rougher than hosted services, accepted for the AWS fit.
- Account deletion must delete the user's moments and photos; covered in its own spec.

## References

- [App Store Review Guidelines, 4.8 Login Services](https://developer.apple.com/app-store/review/guidelines/)
