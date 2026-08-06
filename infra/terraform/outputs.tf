output "resource_group_name" {
  description = "Nom du resource group créé"
  value       = azurerm_resource_group.main.name
}

output "acr_login_server" {
  description = "URL du registre ACR (cible de `docker login` / `docker push`)"
  value       = azurerm_container_registry.main.login_server
}

output "acr_name" {
  description = "Nom du registre ACR créé"
  value       = azurerm_container_registry.main.name
}
