# What the deploy job may do with the role infra/bootstrap created, and
# nothing more: push this image, update this function, read this secret
data "aws_iam_role" "deploy" {
  name = "savor-deploy"
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy-api"
  role   = data.aws_iam_role.deploy.name
  policy = data.aws_iam_policy_document.deploy.json
}

data "aws_iam_policy_document" "deploy" {
  # Docker login to ECR; this action can't be scoped to a repository
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PushApiImage"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.api.arn]
  }

  # GetFunctionConfiguration is what `aws lambda wait function-updated` polls
  statement {
    sid       = "UpdateApiFunction"
    actions   = ["lambda:UpdateFunctionCode", "lambda:GetFunctionConfiguration"]
    resources = [aws_lambda_function.api.arn]
  }

  # For migrations
  statement {
    sid       = "ReadDatabaseSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database.arn]
  }
}
