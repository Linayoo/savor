# GitHub Actions signs in with OIDC, so no AWS keys are stored in GitHub.
# AWS trusts GitHub's certificate authority itself, so no thumbprint is needed.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Only jobs on this repository's main branch can assume the role. Its
# permissions live in infra/app (deploy.tf), next to the resources they name.
resource "aws_iam_role" "deploy" {
  name                 = "savor-deploy"
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # A job that names a GitHub environment gets a different subject, so the
    # deploy job doesn't use one
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}
