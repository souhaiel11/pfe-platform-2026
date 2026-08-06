variable "subscription_id" {
  description = "ID de la souscription Azure cible (Azure for Students)"
  type        = string
  default     = "1b569162-604e-4c4c-a1fc-08b55161740a"
}

variable "location" {
  description = "Région Azure de déploiement"
  type        = string
  default     = "francecentral"
}

variable "resource_group_name" {
  description = "Nom du resource group durable (RG + ACR)"
  type        = string
  default     = "rg-pfe-devsecops"
}

variable "acr_name" {
  description = "Nom du registre ACR — doit être globalement unique sur Azure, alphanumérique uniquement (pas de tiret/underscore), 5 à 50 caractères"
  type        = string
  default     = "acrpfedevsecops"

  validation {
    condition     = can(regex("^[a-zA-Z0-9]{5,50}$", var.acr_name))
    error_message = "acr_name doit être alphanumérique uniquement (aucun tiret, underscore ou espace) et faire entre 5 et 50 caractères."
  }
}

variable "acr_sku" {
  description = "SKU du registre ACR"
  type        = string
  default     = "Basic"
}
