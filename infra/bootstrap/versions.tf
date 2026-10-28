# Applied once from the developer's machine, with local state (README,
# "Deploying"). Creates what infra/app and the deploy job need first.
terraform {
  required_version = "1.16.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.68.0"
    }
  }
}

provider "aws" {
  region = "eu-central-1"

  default_tags {
    tags = {
      Project = "savor"
      Stack   = "bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}
