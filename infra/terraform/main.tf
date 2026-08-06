resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
}

resource "azurerm_container_registry" "main" {
  name                = var.acr_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = var.acr_sku

  # admin_enabled=true : identifiants admin ACR activés pour permettre un
  # `docker login`/`docker push` simple au démarrage. À reconsidérer plus
  # tard en faveur d'un service principal / managed identity dédié.
  admin_enabled = true
}
