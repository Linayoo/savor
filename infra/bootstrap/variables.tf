variable "budget_email" {
  description = "Where the budget alerts go"
  type        = string
}

variable "github_repository" {
  description = "The repository whose main branch may deploy, as owner/name"
  type        = string
  default     = "Linayoo/savor"
}
