terraform {
  required_version = ">= 1.7.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # State local pour l'instant (fichier terraform.tfstate sur cette machine).
  # Jamais versionné (voir .gitignore) — à migrer vers un backend distant
  # (azurerm storage) si le state doit être partagé.
  backend "local" {}
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}
