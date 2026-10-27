# 0002: API hosting on AWS Lambda (container image)

Status: accepted
Date: 2026-10-27

## Context

Savor needs an HTTP API for sync, auth-protected data access and later the LLM and agent features.
Traffic will be very low for a long time: one user at first, a few later.
The API is Node + tRPC, and the project should demonstrate Docker and AWS.
Infrastructure lives in eu-central-1 and is managed with Terraform.

## Options considered

1. Lambda running a Docker image, behind API Gateway (HTTP API)
2. ECS Fargate service behind an Application Load Balancer
3. Lambda with a zip package (no Docker)

## Decision

Option 1. The tRPC router runs in one Lambda function, built as a container image on the AWS Node.js 24 base image (`public.ecr.aws/lambda/nodejs:24`), pushed to ECR in eu-central-1, and exposed through an API Gateway HTTP API with tRPC's `awsLambdaRequestHandler`. The same image also runs locally with Docker for development.

## Consequences

- Close to zero cost at rest. Fargate needs a load balancer and an always-on task, a monthly cost even with no traffic.
- Docker is still part of the story: one Dockerfile for local development and deployment.
- Cold starts add latency to the first request after a quiet period. Neon also wakes its compute after 5 idle minutes (ADR 0003), which adds to the delay. Acceptable for a personal app.
- After several weeks without calls, Lambda marks a container image function Inactive and rejects the first call while it re-optimizes the image. Two mitigations:
  - The app retries failed syncs, so a rejected call only delays a sync.
  - A weekly EventBridge schedule calls the function to keep it active.
- Lambda limits shape the design: an HTTP API integration times out after 30 seconds (not adjustable) and accepts at most 10 MB per request. Photos go straight to S3 with presigned URLs, never through the API.
- Known limit: HTTP APIs don't support response streaming, which tRPC lists only for Function URLs and REST APIs. The monthly letter (M3) doesn't need it, since it's written in the background.
- Node 24 is supported on Lambda until 30 April 2028. The Node 22 base image is deprecated on 30 April 2027.
- Long-running work (the agent in M4) runs in separate functions fed by SQS, not in the API.
- Moving to Fargate later only changes the entry point and the Terraform, since the router is plain tRPC.

## References

- [Create a Lambda function using a container image](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html), including the function lifecycle and Inactive state
- [Deploy Node.js Lambda functions with container images](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-image.html), with the base images and deprecation dates
- [Quotas for HTTP APIs in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
- [tRPC AWS Lambda adapter](https://trpc.io/docs/server/adapters/aws-lambda)
