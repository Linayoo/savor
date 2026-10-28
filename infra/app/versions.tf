# Everything the API runs on. State lives in the bootstrap bucket, passed at
# init: terraform init -backend-config="bucket=savor-tfstate-<account id>"
terraform {
  required_version = "1.16.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.68.0"
    }
    # Community provider Neon's docs point to; moving to neondatabase/neon
    neon = {
      source  = "kislerdm/neon"
      version = "0.18.0"
    }
  }

  backend "s3" {
    key          = "app/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "eu-central-1"

  default_tags {
    tags = {
      Project = "savor"
      Stack   = "app"
    }
  }
}

# Reads NEON_API_KEY from the environment
provider "neon" {}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id    = data.aws_caller_identity.current.account_id
  region        = data.aws_region.current.region
  function_name = "savor-api"
  # Built from the name, so the ECR policy can name the function before it exists
  function_arn = "arn:aws:lambda:${local.region}:${local.account_id}:function:${local.function_name}"
}
