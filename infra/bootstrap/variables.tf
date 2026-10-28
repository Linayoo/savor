variable "budget_email" {
  description = "Where the budget alerts go"
  type        = string
}

variable "github_subject_prefix" {
  description = "OIDC subject prefix of the repository whose main branch may deploy. The repository uses immutable subjects (owner and repository ids); look it up with gh api repos/OWNER/REPO/actions/oidc/customization/sub"
  type        = string
  default     = "repo:Linayoo@103110270/savor@1434441712"
}
