# The API's Lambda image (ADR 0002). Build from the repo root:
#   docker buildx build --platform linux/arm64 --provenance=false \
#     -f apps/api/Dockerfile .

FROM public.ecr.aws/lambda/nodejs:24 AS build
WORKDIR /build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Dependencies first, so the layer is cached until the lockfile changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @savor/api...

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @savor/api build

# Only the bundle goes into the image
FROM public.ecr.aws/lambda/nodejs:24
COPY --from=build /build/apps/api/dist/index.mjs ${LAMBDA_TASK_ROOT}/
CMD ["index.handler"]
