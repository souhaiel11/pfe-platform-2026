# 📋 Fiche Technique — Frontend DevSecOps IA
**Projet** : Plateforme d'orchestration DevSecOps intelligente  
**Auteur** : Amri Souhaiel | **École** : ESPRIT | **Entreprise** : Vermeg

---

## 1. Structure du projet

```
src/
├── styles.scss                          ← Design system global (dark theme)
├── main.ts                              ← Bootstrap Angular
├── environments/
│   └── environment.ts                   ← URLs et config (modifier ici)
└── app/
    ├── app.config.ts                    ← Configuration Angular standalone
    ├── app.routes.ts                    ← Toutes les routes
    ├── app.component.ts                 ← Composant racine
    │
    ├── core/                            ← Logique métier partagée
    │   ├── services/
    │   │   ├── api.service.ts           ← TOUS les appels HTTP backend
    │   │   ├── auth.service.ts          ← Login / logout / JWT
    │   │   ├── chat.service.ts          ← Appels webhook n8n ChatOps
    │   │   ├── websocket.service.ts     ← Connexion temps réel
    │   │   └── toast.service.ts         ← Notifications UI
    │   ├── guards/
    │   │   └── auth.guard.ts            ← Protection des routes
    │   └── interceptors/
    │       └── jwt.interceptor.ts       ← Ajout token Bearer automatique
    │
    ├── shared/                          ← Composants réutilisables
    │   ├── layout/
    │   │   └── layout.component.ts      ← Sidebar + topbar + router-outlet
    │   ├── chat-widget/
    │   │   └── chat-widget.component.ts ← Assistant IA flottant
    │   └── toast/
    │       └── toast.component.ts       ← Affichage notifications
    │
    └── features/                        ← Pages de l'application
        ├── auth/
        │   └── login.component.ts       ← Page de connexion
        ├── dashboard/
        │   └── dashboard.component.ts   ← Vue d'ensemble + KPIs
        ├── projects/
        │   ├── projects.component.ts    ← Liste des projets
        │   └── project-detail.component.ts ← Détail projet
        ├── incidents/
        │   ├── incidents.component.ts   ← Liste incidents + filtres
        │   └── incident-detail.component.ts ← Détail + rapports IA
        ├── analysis/
        │   └── analysis.component.ts    ← Rapports agents IA
        ├── notifications/
        │   └── notifications.component.ts ← Centre notifications
        ├── admin/
        │   └── admin.component.ts       ← Gestion utilisateurs
        └── settings/
            └── settings.component.ts    ← Configuration plateforme
```

---

## 2. Configuration — environment.ts

```typescript
// src/environments/environment.ts
export const environment = {
  production: false,
  apiUrl:           'http://172.31.172.61:3001/api',  // Backend Spring Boot
  wsUrl:            'ws://172.31.172.61:3001/ws',     // WebSocket
  n8nUrl:           'http://172.31.172.61:5678',      // n8n workflows
  defaultProjectId: '1b16b8d5-8115-4a79-9558-00486a460cc8'
};
```

> ⚠️ Si votre IP WSL change, modifiez uniquement ce fichier.
> Pour trouver votre IP : `ip addr show eth0 | grep "inet " | awk '{print $2}' | cut -d/ -f1`

---

## 3. Routes de l'application

| URL | Composant | Description |
|-----|-----------|-------------|
| `/login` | LoginComponent | Page de connexion |
| `/dashboard` | DashboardComponent | Vue d'ensemble + KPIs |
| `/projects` | ProjectsComponent | Liste des projets |
| `/projects/:id` | ProjectDetailComponent | Détail d'un projet |
| `/incidents` | IncidentsComponent | Liste avec filtres |
| `/incidents/:id` | IncidentDetailComponent | Détail + rapports IA |
| `/analysis` | AnalysisComponent | Rapports agents IA |
| `/notifications` | NotificationsComponent | Centre notifications |
| `/admin` | AdminComponent | Gestion utilisateurs |
| `/settings` | SettingsComponent | Configuration |

---

## 4. Erreurs corrigées par rapport à la version précédente

### FIX #1 — ChatWidget : HttpClientModule en double
**Problème** : Le composant importait `HttpClientModule` alors qu'il était déjà fourni globalement dans `app.config.ts`. Cela créait une instance séparée du `HttpClient` qui ignorait l'intercepteur JWT.

**Avant (incorrect)** :
```typescript
imports: [CommonModule, FormsModule, HttpClientModule] // ❌
```

**Après (correct)** :
```typescript
imports: [CommonModule, FormsModule] // ✅ HttpClient fourni globalement
```

---

### FIX #2 — ChatWidget : Logique dupliquée
**Problème** : Le composant avait sa propre logique HTTP en parallèle du `ChatService`. Résultat : deux chemins de code différents, comportements incohérents.

**Avant (incorrect)** :
```typescript
// Dans chat-widget.component.ts
constructor(private http: HttpClient) {} // ❌ logique en double

sendQuestion() {
  this.http.post(this.n8nUrl, {...}).subscribe(...) // ❌ bypass ChatService
}
```

**Après (correct)** :
```typescript
// Dans chat-widget.component.ts
constructor(private chatService: ChatService) {} // ✅ service unique

send() {
  this.chatService.sendMessage(q); // ✅ une seule source de vérité
}
```

---

### FIX #3 — URL Webhook : test vs production
**Problème** : Le frontend appelait `/webhook-test/chat-agent` (mode test n8n) au lieu de `/webhook/chat-agent` (production). Le workflow devait être ouvert dans l'éditeur n8n pour fonctionner.

**Avant (incorrect)** :
```typescript
n8nUrl = 'http://172.31.172.61:5678/webhook-test/chat-agent'; // ❌
```

**Après (correct)** :
```typescript
// Dans environment.ts
n8nUrl: 'http://172.31.172.61:5678'

// Dans chat.service.ts
private readonly webhookUrl = `${environment.n8nUrl}/webhook/chat-agent`; // ✅
```

> ⚠️ Important : Le workflow WF-Chat doit être **activé** (toggle ON) dans n8n pour que `/webhook/` fonctionne.

---

### FIX #4 — JWT Interceptor : gestion 401
**Problème** : En cas de token expiré, l'utilisateur restait bloqué sans être redirigé vers login.

**Correction** :
```typescript
// jwt.interceptor.ts
catchError((err: HttpErrorResponse) => {
  if (err.status === 401) {
    localStorage.removeItem('token');
    router.navigate(['/login']); // ✅ redirection automatique
  }
  return throwError(() => err);
})
```

---

## 5. Design System

### Couleurs (CSS Variables)
```scss
--accent-blue:   #38bdf8  // Primaire — actions, liens
--accent-green:  #22c55e  // Succès — incidents résolus
--accent-red:    #e24b4a  // Erreur — incidents critiques
--accent-orange: #f59e0b  // Avertissement — medium
--accent-purple: #a78bfa  // Info — incidents bloqués
--bg-primary:    #080c14  // Fond principal
--bg-secondary:  #0b1120  // Cartes, sidebar
```

### Typographie
```
Titres/code : JetBrains Mono (monospace)
Corps :       Inter (sans-serif)
```

### Badges statuts incidents
```
OPEN               → rouge
ANALYZING          → bleu
CORRECTION_PROPOSED → orange
CORRECTION_APPLIED → vert
RESOLVED           → vert
CLOSED             → gris
BLOCKED            → violet
```

---

## 6. Installation et démarrage

### Prérequis
```bash
Node.js >= 18
npm >= 9
Angular CLI >= 17
```

### Installation
```bash
cd ~/devsecops-platform/frontend

# Copier les fichiers src/ dans ce dossier
# Puis :
npm install
npm start
```

### Build production
```bash
npm run build
# Output : dist/devsecops-frontend/browser/
# Copier dans le container nginx :
docker cp dist/devsecops-frontend/browser/. nginx:/usr/share/nginx/html/
```

---

## 7. Dépendances package.json

```json
{
  "dependencies": {
    "@angular/animations": "^17.0.0",
    "@angular/common": "^17.0.0",
    "@angular/compiler": "^17.0.0",
    "@angular/core": "^17.0.0",
    "@angular/forms": "^17.0.0",
    "@angular/platform-browser": "^17.0.0",
    "@angular/router": "^17.0.0",
    "rxjs": "~7.8.0",
    "tslib": "^2.3.0",
    "zone.js": "~0.14.0"
  },
  "devDependencies": {
    "@angular-devkit/build-angular": "^17.0.0",
    "@angular/cli": "^17.0.0",
    "@angular/compiler-cli": "^17.0.0",
    "sass": "^1.69.0",
    "typescript": "~5.2.0"
  }
}
```

---

## 8. Points importants pour la soutenance

### Ce que vous devez savoir expliquer

**Pourquoi Angular standalone ?**
> Les composants standalone (Angular 14+) n'ont pas besoin de NgModule.
> Plus simple, plus rapide, meilleur pour le lazy loading des routes.

**Pourquoi lazy loading ?**
> Chaque page est chargée uniquement quand l'utilisateur y accède.
> Améliore le temps de chargement initial de l'application.

**Pourquoi JWT Interceptor ?**
> Intercepte automatiquement TOUTES les requêtes HTTP et ajoute le header
> `Authorization: Bearer <token>`. Sans ça, chaque service devrait ajouter
> le token manuellement — duplication de code et risque d'oubli.

**Pourquoi ChatService et pas HttpClient direct dans le widget ?**
> Le Service est un singleton — une seule instance partagée dans toute l'app.
> L'état des messages (historique, loading) est centralisé.
> Le composant se contente d'afficher — pas de logique métier dedans.
> C'est le principe de **séparation des responsabilités**.

**Pourquoi /webhook/ et pas /webhook-test/ ?**
> n8n a deux modes :
> - `/webhook-test/` : workflow ouvert dans l'éditeur (mode développement)
> - `/webhook/` : workflow activé en production (toggle ON)
> En production, seul `/webhook/` répond correctement.

---

## 9. Commandes utiles

```bash
# Démarrer le frontend
cd ~/devsecops-platform/frontend && npm start

# Vérifier erreurs compilation
ng build 2>&1 | head -50

# Voir logs en temps réel
docker logs devsecops_backend --tail 50 -f

# Tester le chat depuis terminal
curl -X POST http://172.31.172.61:5678/webhook/chat-agent \
  -H "Content-Type: application/json" \
  -d '{"question":"Incidents en cours ?","projectId":"1b16b8d5-8115-4a79-9558-00486a460cc8"}'

# Vérifier containers
docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
```

---

*Fiche technique générée le $(date) — Plateforme DevSecOps IA v1.0*
