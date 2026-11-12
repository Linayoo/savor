# The tRPC API as one container image function (ADR 0002)
resource "aws_lambda_function" "api" {
  function_name = local.function_name
  role          = aws_iam_role.api.arn
  package_type  = "Image"
  image_uri     = data.aws_ecr_image.api.image_uri
  # Built natively on GitHub's arm64 runner
  architectures = ["arm64"]
  memory_size   = 512
  timeout       = 15

  environment {
    variables = {
      NODE_ENV           = "production"
      DATABASE_SECRET_ID = aws_secretsmanager_secret.database.arn
      PHOTOS_BUCKET      = aws_s3_bucket.photos.bucket
      # AWS_REGION is reserved in Lambda
      PHOTOS_BUCKET_REGION = aws_s3_bucket.photos.region
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.api.name
  }

  # Deploys update the image; Terraform only creates the function with one
  lifecycle {
    ignore_changes = [image_uri]
  }

  depends_on = [
    aws_iam_role_policy.api,
    aws_ecr_repository_policy.api,
  ]
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = 14
}

resource "aws_iam_role" "api" {
  name               = local.function_name
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Its own logs, its own secret and the photos, nothing else. The name
# predates the photos; renaming would replace the policy.
resource "aws_iam_role_policy" "api" {
  name   = "logs-and-database-secret"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }

  statement {
    sid       = "ReadDatabaseSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database.arn]
  }

  # Presigned URLs are signed with this role, so they can do no more than this
  statement {
    sid = "PhotoObjects"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      # The upload form tags its object upload=pending; confirmUpload clears
      # the tag (spec 009)
      "s3:PutObjectTagging",
      "s3:DeleteObjectTagging",
    ]
    resources = ["${aws_s3_bucket.photos.arn}/users/*"]
  }

  # Lets HeadObject answer 404 for a photo that was never uploaded, instead
  # of 403
  statement {
    sid       = "ListPhotoKeys"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.photos.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["users/*"]
    }
  }
}
