# 0007: LLM provider and what data it sees

Status: accepted
Date: 2026-11-04

## Context

M3 adds a monthly letter: once a month, Savor writes a short, warm letter from the moments a person kept. That means sending the words of personal moments to a large language model.
The backend runs on AWS Lambda in eu-central-1 (ADR 0002), with Terraform and least-privilege IAM.
Moments are private. Whatever leaves the database should be the minimum the letter needs, should stay in the EU where possible, and must not be used to train models.

## Options considered

1. Claude through Amazon Bedrock, using an EU cross-region inference profile
2. Claude through the Anthropic API directly, with an API key in Secrets Manager
3. Another provider's API

## Decision

Option 1, with option 2 as the fallback if Bedrock can't be used (model access, quotas or EU availability).

- The letter Lambda calls Bedrock with its own IAM role, allowed to invoke only the chosen inference profile and the models behind it. No API key exists to leak or rotate.
- The model is Claude Sonnet 5.5 through the EU inference profile, `eu.anthropic.claude-sonnet-5-5`, never the `global.` profile.
- The model id is configuration, not code, so changing models is a Terraform change.
- Behind a small `LetterWriter` interface, so the provider can change without touching the letter logic, and tests use a fake.

What the model sees, and nothing more:

- For each moment of the month: its date, its kind, and its words.
- Not sent: photos, email, user id, account details, other months.
- The person opts in once, on a screen that says exactly this.

## Consequences

- Data stays inside AWS, in EU regions, under the account's existing IAM and logging.
- No secret to manage, unlike option 2.
- Bedrock's model access and quotas must be enabled for the account; new accounts can have low default quotas. One letter per person per month is far below any quota.
- Bedrock may offer a model version later than the Anthropic API does. Acceptable for a monthly letter.
- Costs are per token. Letters are short and monthly; a token cap per letter and the existing budget alarm bound them.
- The real cost is checked in Cost Explorer after the first letters are written, since Bedrock's price for Sonnet 5.5 couldn't be confirmed beforehand.
- Data handling terms (no training on inputs, retention) were checked against current Bedrock documentation; see Findings and References.
- Photos and the enrichment agent (M4) may later send more to a model; that needs its own decision.

## Findings (checked 2026-11-04)

Model and region:

- No Claude model runs in-Region in eu-central-1. The current ones are served there through the EU geographic inference profile and the global one.
- Claude Sonnet 5.5 (`anthropic.claude-sonnet-5-5`, launched 2026-09-28, EOL no sooner than 2027-09-28) through `eu.anthropic.claude-sonnet-5-5`.
  - From eu-central-1, the profile routes only to eu-central-1, eu-north-1, eu-south-1, eu-south-2, eu-west-1 and eu-west-3.
  - Geographic profiles never change their destination Regions; AWS adds new profiles instead.
  - The `global.` profile routes to any commercial Region, so it isn't used.
- Claude Haiku 5.5 has the same EU profile and Regions, but AWS marks it as a profile with limited model selection.
- Sonnet 5.5 is served through InvokeModel with the Anthropic Messages body, through Converse and through the Messages API on bedrock-runtime. The bedrock-mantle endpoint offers it only in GovCloud.

IAM, for a system-defined inference profile:

- `bedrock:InvokeModel` on the inference profile, `arn:aws:bedrock:eu-central-1:<account>:inference-profile/eu.anthropic.claude-sonnet-5-5`.
- And on the foundation model in every destination Region, `arn:aws:bedrock:<region>::foundation-model/anthropic.claude-sonnet-5-5`.
  - It is limited with the `bedrock:InferenceProfileArn` condition, so the model can be reached only through the profile.
  - `GetInferenceProfile` lists the destination model ARNs, and AWS advises checking them for data residency. Terraform reads them through `aws_bedrock_inference_profile`.

Model access:

- The Model access page is retired in commercial Regions. A model is enabled on its first invocation, which needs:
  - the AWS Marketplace permissions `aws-marketplace:Subscribe`, `Unsubscribe` and `ViewSubscriptions`, for that first call only;
  - for Anthropic, a one-time First Time Use form per account, submitted in the Bedrock console;
  - a valid payment method.
- So the first call is made by the developer in the console playground. The letters role never gets Marketplace permissions.

Data use and retention:

- Bedrock doesn't use inputs or outputs to train models, and doesn't share them with model providers.
- Model providers have no access to the deployment accounts, to Bedrock logs, or to prompts and completions.
- Content is encrypted, and invocation logging stays off unless the account enables it.
- Abuse detection: among Claude models, only Fable 5 and Fable 5.1 retain traffic (30 days). Sonnet 5.5 isn't among them.
  - The per-Region data retention setting (`none`, `default`, `aws_review`) stays at `inherit`.
  - Retained data, where a model requires it, is stored in the destination Region.
- Bedrock on-demand prices are billed through AWS Marketplace and weren't legible on the pricing page. The Anthropic API price for Sonnet 5.5 is 2 USD per million input tokens and 10 USD per million output tokens. One letter is about 3,000 tokens in and 400 out, about one cent.

Request parameters for Sonnet 5.5:

- `temperature` and other sampling values are refused.
- `thinking: {type: "disabled"}` returns 400. The lowest setting is `{type: "between_tools"}` at effort `high` or below.
- Thinking counts toward `max_tokens`, so a letter capped near 800 tokens runs with `between_tools`.
- A safety decline returns HTTP 200 with `stop_reason: "refusal"`, and is treated like any other failed check.

SDK: `@aws-sdk/client-bedrock-runtime` 3.1161.0, the same release line as the API's other AWS clients. The code uses `InvokeModelCommand` with an `anthropic_version: "bedrock-2023-05-31"` body, so the exact request is plain JSON a test can compare.

## References

- [Claude Sonnet 5.5 on Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html): IDs, Regional availability, EU destination Regions
- [Claude Haiku 5.5 on Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html)
- [Supported Regions and models for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html)
- [Prerequisites for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html): the IAM policy for a profile and its models
- [Request access to models](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html): automatic access, Marketplace permissions, the Anthropic use case form
- [Data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html): model deployment accounts, no provider access
- [Data retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html)
- [Abuse detection](https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html)
- [Amazon Bedrock FAQs](https://aws.amazon.com/bedrock/faqs/): no training on inputs or outputs, nothing shared with model providers
- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
