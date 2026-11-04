variable "letter_model_id" {
  description = "The Bedrock inference profile the letters job calls (ADR 0007): EU only, never global"
  type        = string
  default     = "eu.anthropic.claude-sonnet-5-5"

  validation {
    condition     = startswith(var.letter_model_id, "eu.")
    error_message = "Letters stay in the EU: use an eu. inference profile."
  }
}

variable "neon_org_id" {
  description = "Neon organization for the project (Neon console, Organization settings)"
  type        = string
}
