output "api_url" {
  description = "The GitHub repository variable SAVOR_API_URL, and the smoke test's"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "user_pool_id" {
  value = aws_cognito_user_pool.users.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.mobile.id
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "database_secret_arn" {
  value = aws_secretsmanager_secret.database.arn
}
