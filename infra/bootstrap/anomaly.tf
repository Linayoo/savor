# Cost Anomaly Detection (spec 009). AWS made the monitor and its daily email
# for this account when Cost Explorer was first opened; they're imported here
# rather than made twice. The budget is $5 a month, so the alert fires at $1
# of unexpected cost instead of AWS's default $100 and 40%.

import {
  to = aws_ce_anomaly_monitor.services
  id = "arn:aws:ce::979311683174:anomalymonitor/601b5f5d-dc69-47b1-8563-65d2fdc3f4ac"
}

import {
  to = aws_ce_anomaly_subscription.daily
  id = "arn:aws:ce::979311683174:anomalysubscription/675cdbe6-cafb-49d4-8a49-bf97f5bb81b2"
}

resource "aws_ce_anomaly_monitor" "services" {
  name              = "Default-Services-Monitor"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

resource "aws_ce_anomaly_subscription" "daily" {
  name             = "Default-Services-Subscription"
  frequency        = "DAILY"
  monitor_arn_list = [aws_ce_anomaly_monitor.services.arn]

  subscriber {
    type    = "EMAIL"
    address = var.budget_email
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = ["1"]
    }
  }
}
