# The API's container image. Deploys push one per commit, tagged with its SHA.
resource "aws_ecr_repository" "api" {
  name = "savor-api"
  # Mutable, so a re-run can push the same commit; Lambda pins the digest anyway
  image_tag_mutability = "MUTABLE"
  # Images are rebuilt from the repo, so teardown may delete them
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}

# Lambda pulls the image as itself; only for this function
resource "aws_ecr_repository_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy     = data.aws_iam_policy_document.ecr_lambda_pull.json
}

data "aws_iam_policy_document" "ecr_lambda_pull" {
  statement {
    sid     = "LambdaPull"
    actions = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.function_arn]
    }
  }
}

# The newest pushed image: before the first apply, README pushes one.
# Afterwards deploys update the function and Terraform ignores the change.
data "aws_ecr_image" "api" {
  repository_name = aws_ecr_repository.api.name
  most_recent     = true
}
