# The daily job for deleted accounts (spec 010): it finishes deletions that
# stopped partway and forgets deleted accounts 90 days after they finished.
# It runs in the API function, which may already delete photos and Cognito
# users (function.tf); the handler takes { source = "savor.accounts" } for it.
resource "aws_scheduler_schedule" "accounts" {
  name                         = "savor-accounts"
  schedule_expression          = "cron(0 4 * * ? *)"
  schedule_expression_timezone = "Europe/Zurich"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.api.arn
    role_arn = aws_iam_role.accounts_schedule.arn
    input    = jsonencode({ source = "savor.accounts" })
  }
}

resource "aws_iam_role" "accounts_schedule" {
  name               = "savor-accounts-schedule"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
}

resource "aws_iam_role_policy" "accounts_schedule" {
  name   = "invoke-api"
  role   = aws_iam_role.accounts_schedule.id
  policy = data.aws_iam_policy_document.accounts_schedule.json
}

data "aws_iam_policy_document" "accounts_schedule" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.api.arn]
  }
}
