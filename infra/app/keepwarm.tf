# Lambda marks a container image function Inactive after weeks without calls;
# a weekly call keeps it active (ADR 0002). The handler returns at once.
resource "aws_scheduler_schedule" "keepwarm" {
  name                = "savor-api-keepwarm"
  schedule_expression = "rate(7 days)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.api.arn
    role_arn = aws_iam_role.keepwarm.arn
    input    = jsonencode({ source = "savor.keepwarm" })
  }
}

resource "aws_iam_role" "keepwarm" {
  name               = "savor-api-keepwarm"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
}

data "aws_iam_policy_document" "scheduler_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role_policy" "keepwarm" {
  name   = "invoke-api"
  role   = aws_iam_role.keepwarm.id
  policy = data.aws_iam_policy_document.keepwarm.json
}

data "aws_iam_policy_document" "keepwarm" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.api.arn]
  }
}
