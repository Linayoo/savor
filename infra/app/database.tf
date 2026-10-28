# Neon in AWS Frankfurt (ADR 0003). Every project comes with a database and a
# role; the branch block names both savor. Destroying the project deletes the
# data: Neon's Free plan has no deletion protection.
resource "neon_project" "savor" {
  name       = "savor"
  org_id     = var.neon_org_id
  region_id  = "aws-eu-central-1"
  pg_version = 17

  # The Free plan's maximum; the provider's default of 24 hours is refused
  history_retention_seconds = 21600

  branch {
    name          = "main"
    database_name = "savor"
    role_name     = "savor"
  }
}

# The Lambda uses the pooled host. Migrations use the direct one, since the
# pooler runs in transaction mode.
resource "aws_secretsmanager_secret" "database" {
  name                    = "savor/database"
  description             = "Neon connection strings for the Savor API"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "database" {
  secret_id = aws_secretsmanager_secret.database.id
  secret_string = jsonencode({
    url          = neon_project.savor.connection_uri_pooler
    migrationUrl = neon_project.savor.connection_uri
  })
}
