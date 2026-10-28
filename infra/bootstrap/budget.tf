# AWS Budgets emails a verification link to a new recipient; it has to be
# opened within 12 hours while signed in to the account.
resource "aws_budgets_budget" "monthly" {
  name         = "savor-monthly"
  budget_type  = "COST"
  limit_amount = "5"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = [80, 100]

    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.budget_email]
    }
  }
}
