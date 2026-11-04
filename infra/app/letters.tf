# The monthly letter (spec 007, ADR 0007): a second function from the API's
# image, run by a schedule, that may call Bedrock. The API's role can't.

# The EU inference profile and the models behind it, one per destination
# Region, all in the EU
data "aws_bedrock_inference_profile" "letters" {
  inference_profile_id = var.letter_model_id
}

resource "aws_lambda_function" "letters" {
  function_name = local.letters_function_name
  role          = aws_iam_role.letters.arn
  package_type  = "Image"
  image_uri     = data.aws_ecr_image.api.image_uri
  architectures = ["arm64"]
  memory_size   = 512
  # A letter takes seconds; this leaves room for a few dozen people
  timeout = 300

  image_config {
    command = ["letters.handler"]
  }

  environment {
    variables = {
      NODE_ENV           = "production"
      DATABASE_SECRET_ID = aws_secretsmanager_secret.database.arn
      LETTER_MODEL_ID    = var.letter_model_id
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.letters.name
  }

  # Deploys update the image, as for the API
  lifecycle {
    ignore_changes = [image_uri]
  }

  depends_on = [
    aws_iam_role_policy.letters,
    aws_ecr_repository_policy.api,
  ]
}

# Days 2 and 3 of the schedule are the retries
resource "aws_lambda_function_event_invoke_config" "letters" {
  function_name          = aws_lambda_function.letters.function_name
  maximum_retry_attempts = 0
}

resource "aws_cloudwatch_log_group" "letters" {
  name              = "/aws/lambda/${local.letters_function_name}"
  retention_in_days = 14
}

resource "aws_iam_role" "letters" {
  name               = local.letters_function_name
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "letters" {
  name   = "logs-database-secret-and-model"
  role   = aws_iam_role.letters.id
  policy = data.aws_iam_policy_document.letters.json
}

data "aws_iam_policy_document" "letters" {
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.letters.arn}:*"]
  }

  statement {
    sid       = "ReadDatabaseSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database.arn]
  }

  statement {
    sid       = "InvokeInferenceProfile"
    actions   = ["bedrock:InvokeModel"]
    resources = [data.aws_bedrock_inference_profile.letters.inference_profile_arn]
  }

  # The model in each destination Region, only when reached through the
  # profile above
  statement {
    sid       = "InvokeModelThroughProfile"
    actions   = ["bedrock:InvokeModel"]
    resources = data.aws_bedrock_inference_profile.letters.models[*].model_arn

    condition {
      test     = "StringEquals"
      variable = "bedrock:InferenceProfileArn"
      values   = [data.aws_bedrock_inference_profile.letters.inference_profile_arn]
    }
  }
}

# 08:00 in Zurich on the 1st, 2nd and 3rd. Each run writes only the letters
# still missing.
resource "aws_scheduler_schedule" "letters" {
  name                         = "savor-letters"
  schedule_expression          = "cron(0 8 1-3 * ? *)"
  schedule_expression_timezone = "Europe/Zurich"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.letters.arn
    role_arn = aws_iam_role.letters_schedule.arn
    input    = jsonencode({ source = "savor.letters" })
  }
}

resource "aws_iam_role" "letters_schedule" {
  name               = "savor-letters-schedule"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
}

resource "aws_iam_role_policy" "letters_schedule" {
  name   = "invoke-letters"
  role   = aws_iam_role.letters_schedule.id
  policy = data.aws_iam_policy_document.letters_schedule.json
}

data "aws_iam_policy_document" "letters_schedule" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.letters.arn]
  }
}
