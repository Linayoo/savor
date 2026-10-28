output "state_bucket" {
  description = "Passed to `terraform init` in infra/app"
  value       = aws_s3_bucket.state.bucket
}

output "deploy_role_arn" {
  description = "The GitHub repository variable AWS_DEPLOY_ROLE_ARN"
  value       = aws_iam_role.deploy.arn
}
