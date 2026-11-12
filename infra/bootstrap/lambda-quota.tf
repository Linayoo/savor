# The account started with a Lambda concurrency limit of 10, a new account's
# reduced limit (aws lambda get-account-settings, 2026-11-12). Reserving
# concurrency for the API and letters functions (spec 009) needs 100 left
# unreserved, so this asks for the standard 1,000. AWS decides; until it
# does, `terraform plan` shows the request as pending, and the reserved
# concurrency in infra/app waits for it.
resource "aws_servicequotas_service_quota" "lambda_concurrency" {
  service_code = "lambda"
  quota_code   = "L-B99A9384"
  value        = 1000
}
