// Gère la saisie et la vérification des paramètres d’un projet.
import { userHttpError } from '../../core/http-error-message';
import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ProjectEventsService } from '../../core/services/project-events.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-project-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './project-form.component.html',
  styleUrls: ['./project-form.component.scss'],
})
export class ProjectFormComponent implements OnInit {
  form!: FormGroup;
  isEdit      = false;
  projectId   = '';
  loading     = false;
  // Séparé de `loading` (réservé à save()) : loadProject() ne doit jamais
  // faire afficher le libellé « Sauvegarde… » du bouton pendant un simple
  // chargement -- les deux opérations ne se chevauchent jamais, mais
  // partager le même flag mélangeait leurs libellés.
  projectLoading = false;
  validating  = false;
  saveSuccess = false;
  saveError   = '';
  validationResult: any = null;
  activeSection = 'general';

  // Identifiants Jenkins — flux séparé, write-only, ADMIN-ONLY (jamais
  // mélangé au formulaire général : le token n'est jamais préchargé, jamais
  // relu). Voir PUT /projects/:id/jenkins-credentials.
  jenkinsCredentialConfigured = false;
  jenkinsCredUsername = '';
  jenkinsCredToken = '';
  jenkinsCredBusy = false;
  jenkinsCredMessage = '';
  jenkinsCredSuccess = false;

  // §6 — mêmes icônes que le reste de la plateforme (police « ti »), pas des
  // émojis dont le rendu change d'un système à l'autre.
  sections = [
    { id: 'general',       label: 'Général',   icon: 'ti-file-description' },
    { id: 'cicd',          label: 'CI/CD',     icon: 'ti-git-branch' },
    { id: 'sonarqube',     label: 'SonarQube', icon: 'ti-search' },
    { id: 'sources',       label: 'Sources',   icon: 'ti-link' },
  ];

  // ── Suggestions de remplissage ───────────────────────────────────────── Les adresses d'infrastructure sont identiques d'un projet à l'autre.
  suggestions: Record<string, string> = {};

  /** Suggestion pour un champ, ou chaîne vide s'il n'y en a pas. */
  suggestionPour(champ: string): string {
    // Par convention de la chaîne, le nom du job Jenkins et la clé SonarQube
    // valent le nom du projet. On les dérive donc de la saisie en cours.
    if (champ === 'jenkinsJobName' || champ === 'sonarqubeKey') {
      const nom = String(this.form?.get('name')?.value || '').trim();
      return /^[A-Za-z0-9._-]+$/.test(nom) ? nom : '';
    }
    return this.suggestions[champ] || '';
  }

  /** Le champ est vide et une suggestion existe : on peut la reprendre. */
  suggestionDisponible(champ: string): boolean {
    return !String(this.form?.get(champ)?.value || '').trim() && !!this.suggestionPour(champ);
  }

  /** Reprend la suggestion dans le champ (touche Entrée ou clic). */
  accepterSuggestion(champ: string) {
    const v = this.suggestionPour(champ);
    if (v) this.form.get(champ)?.setValue(v);
  }

  /** Remplit les champs laissés vides avec leur suggestion. */
  appliquerSuggestions() {
    for (const champ of ['jenkinsInternalUrl', 'jenkinsPublicUrl', 'sonarqubeUrl',
                         'sonarqubePublicUrl', 'jenkinsJobName', 'sonarqubeKey']) {
      if (this.suggestionDisponible(champ)) this.accepterSuggestion(champ);
    }
  }

  /** Valeur la plus répandue parmi les projets existants, pour chaque adresse. */
  private chargerSuggestions() {
    this.api.getProjects().subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (projets: any[]) => {
        /** Retient la valeur la plus fréquente du champ pour la proposer dans le formulaire. */
        const retenir = (champ: string) => {
          const comptes = new Map<string, number>();
          for (const p of projets || []) {
            const v = String(p?.[champ] || '').trim();
            if (v) comptes.set(v, (comptes.get(v) || 0) + 1);
          }
          const meilleur = [...comptes.entries()].sort((a, b) => b[1] - a[1])[0];
          if (meilleur) this.suggestions[champ] = meilleur[0];
        };
        ['jenkinsInternalUrl', 'jenkinsPublicUrl', 'sonarqubeUrl', 'sonarqubePublicUrl'].forEach(retenir);
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { /* Pas de suggestion : le formulaire reste utilisable. */ },
    });
  }

  // Catalogue des champs : libellé exact affiché et onglet d'appartenance.
  // Sans lui, un champ invalide situé sur un onglet masqué (*ngIf) reste
  // introuvable : l'utilisateur clique « Sauvegarder », rien ne se passe, et
  // le message d'erreur en ligne est rendu dans un bloc qui n'existe pas.
  private static readonly CHAMPS: Record<string, { label: string; section: string }> = {
    name:               { label: 'Nom du projet',                section: 'general'   },
    jenkinsInternalUrl: { label: 'Jenkins URL interne',          section: 'cicd'      },
    jenkinsPublicUrl:   { label: 'Jenkins URL publique',         section: 'cicd'      },
    jenkinsJobName:     { label: 'Nom du job',                   section: 'cicd'      },
    jenkinsJobPath:     { label: 'Jenkins Job Path',             section: 'cicd'      },
    githubRepo:         { label: 'Dépôt',                        section: 'cicd'      },
    sonarqubeUrl:       { label: 'SonarQube URL interne',        section: 'sonarqube' },
    sonarqubePublicUrl: { label: 'SonarQube URL publique',       section: 'sonarqube' },
    sonarqubeKey:       { label: 'Clé du projet',                section: 'sonarqube' },
    trivyReportPath:    { label: 'Rapport Trivy',                section: 'sources'   },
    owaspReportPath:    { label: 'Rapport OWASP Dependency-Check', section: 'sources' },
    zapReportPath:      { label: 'Rapport ZAP',                  section: 'sources'   },
    dockerfilePath:     { label: 'Dockerfile',                   section: 'sources'   },
  };

  // Raison lisible, par champ et par type d'erreur. Générique en dernier
  // recours, jamais « champ invalide » tout court quand on peut faire mieux.
  private raison(champ: string, erreurs: Record<string, any>): string {
    if (erreurs['required'])  return 'obligatoire, actuellement vide';
    if (erreurs['minlength']) return `${erreurs['minlength'].requiredLength} caractères minimum`;
    if (erreurs['pattern']) {
      switch (champ) {
        case 'jenkinsJobName':
          return 'lettres, chiffres, point, tiret et souligné uniquement — le caractère « / » '
               + 'est refusé : un chemin multibranche se saisit dans « Jenkins Job Path »';
        case 'githubRepo':
          return 'format attendu « propriétaire/dépôt », sans https:// ni .git';
        case 'dockerfilePath':
          return 'chemin relatif simple, sans « .. »';
        default:
          return 'chemin relatif simple ou URL http(s), sans « .. »';
      }
    }
    return 'valeur refusée';
  }

  // ── Test de connexion, clé de l'enregistrement ─────────────────────────
  // Le bouton Sauvegarder reste grisé tant que le test n'a pas conclu que la
  // configuration est exploitable. Toute modification du formulaire après un
  // test réussi le réinvalide : on ne peut pas enregistrer une configuration
  // différente de celle qui a été vérifiée.
  test: { controles: any[]; bloquant: boolean; autoriseEnregistrement: boolean; verifieLe?: string } | null = null;
  testEnCours = false;
  testErreur = '';

  /** Vrai seulement après un test concluant portant sur la saisie actuelle. */
  get testPasse(): boolean { return !!this.test?.autoriseEnregistrement; }

  /** Renvoie enregistrement Possible pour le traitement ou l’affichage. */
  get enregistrementPossible(): boolean {
    return !this.loading && !this.projectLoading && !this.testEnCours && this.testPasse;
  }

  /** Raison pour laquelle l'enregistrement est encore impossible. */
  raisonBlocage(): string {
    if (this.testEnCours) return 'Test de connexion en cours…';
    if (!this.test) return 'Lancez le test de configuration : l’enregistrement en dépend.';
    if (this.test.bloquant) return 'Corrigez les points en rouge, puis relancez le test.';
    return '';
  }

  // Liste des champs en faute, dans l'ordre des onglets.
  champsEnFaute: { champ: string; label: string; section: string; sectionLabel: string; raison: string }[] = [];

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private router: Router,
    private route: ActivatedRoute,
    private projectEvents: ProjectEventsService,
    public auth: AuthService,
  ) {}

  /** Charge les données nécessaires à l’ouverture du composant. */
  ngOnInit() {
    this.buildForm();
    this.chargerSuggestions();
    // Un test porte sur une saisie précise. Dès que la saisie change, le
    // verdict ne vaut plus : on le jette et le bouton Sauvegarder se regrise.
    this.form.valueChanges.subscribe(() => { if (this.test) this.test = null; });
    this.projectId = this.route.snapshot.params['id'];
    if (this.projectId) {
      this.isEdit = true;
      this.loadProject();
    }
  }

  /** Construit formulaire. */
  private buildForm() {
    this.form = this.fb.group({
      // Général
      name:        ['', [Validators.required, Validators.minLength(3)]],
      description: [''],
      environment: ['dev'],
      // CI/CD
      cicdTool:       ['jenkins'],
      jenkinsUrl:         [''],
      jenkinsInternalUrl: [''],
      jenkinsPublicUrl:   [''],
      jenkinsJobName: ['', [Validators.required, Validators.pattern(/^[a-zA-Z0-9._-]+$/)]],
      jenkinsJobPath: [''],
      githubRepo:     ['', [Validators.required, Validators.pattern(/^[\w-]+\/[\w.-]+$/)]],
      // SonarQube
      sonarqubeUrl:   [''],
      sonarqubePublicUrl: [''],
      sonarqubeKey:   [''],
      // Sources / preuves — chemins RÉELS des rapports produits par le
      // pipeline de ce projet, et chemin du Dockerfile. Vides, l'UI affiche
      // « Source non disponible » pour ces preuves : jamais un chemin
      // supposé par convention d'outil (tous les projets ne sont pas Maven).
      trivyReportPath: ['', [Validators.pattern(/^(?:https?:\/\/[^\s<>"']+|(?!.*\.\.)[A-Za-z0-9_.\/@-]+)$/)]],
      owaspReportPath: ['', [Validators.pattern(/^(?:https?:\/\/[^\s<>"']+|(?!.*\.\.)[A-Za-z0-9_.\/@-]+)$/)]],
      zapReportPath:   ['', [Validators.pattern(/^(?:https?:\/\/[^\s<>"']+|(?!.*\.\.)[A-Za-z0-9_.\/@-]+)$/)]],
      dockerfilePath:  ['', [Validators.pattern(/^(?!.*\.\.)[A-Za-z0-9_.\/-]+$/)]],
    });
  }

  /** Charge le projet. */
  private loadProject() {
    this.projectLoading = true;
    this.api.getProject(this.projectId).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (p: any) => {
        this.form.patchValue(p);
        this.jenkinsCredentialConfigured = !!p.jenkinsCredentialConfigured;
        this.form.markAsPristine();
        this.projectLoading = false;
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.saveError = 'Impossible de charger la configuration du projet. Actualisez la page pour réessayer.'; this.projectLoading = false; }
    });
  }

  /** Enregistre les données fournies. */
  save() {
    if (this.loading || this.projectLoading || this.testEnCours) return;
    // Garde côté code, en plus du bouton grisé : l'enregistrement ne part pas
    // sans un test concluant portant sur la saisie courante.
    this.appliquerSuggestions();
    if (!this.testPasse) {
      this.saveError = this.raisonBlocage() || 'La configuration doit être testée avant enregistrement.';
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.champsEnFaute = this.collecterChampsEnFaute();
      this.saveSuccess = false;
      this.saveError = this.champsEnFaute.length === 1
        ? 'Un champ empêche l’enregistrement.'
        : `${this.champsEnFaute.length} champs empêchent l’enregistrement.`;
      // Basculer sur l'onglet du premier champ fautif : sans cela, le message
      // en ligne reste dans un bloc masqué et l'utilisateur ne le voit jamais.
      if (this.champsEnFaute.length) this.activeSection = this.champsEnFaute[0].section;
      return;
    }
    this.champsEnFaute = [];
    this.loading = true;
    this.saveError = '';
    this.saveSuccess = false;

    // Un champ facultatif laissé vide vaut « non configuré », pas « chaîne
    // vide ». @IsOptional() de class-validator n'ignore que null et undefined :
    // une chaîne vide est bel et bien validée, et échoue alors sur le motif du
    // champ. Constaté en réel — sonarqubePublicUrl et les quatre chemins de
    // preuves, laissés vides, faisaient échouer la création avec six messages
    // que l'interface n'affichait même pas. On envoie donc null.
    const brut = this.form.getRawValue();
    const payload = Object.fromEntries(
      Object.entries(brut).map(([cle, valeur]) =>
        [cle, typeof valeur === 'string' && valeur.trim() === '' ? null : valeur]),
    );

    const req = this.isEdit
      ? this.api.updateProject(this.projectId, payload)
      : this.api.createProject(payload);

    const wasCreate = !this.isEdit;
    req.subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (p: any) => {
        this.loading = false;
        this.saveSuccess = true;
        this.form.markAsPristine();
        if (!this.isEdit) { this.projectId = p.id; this.isEdit = true; }
        if (wasCreate) {
          this.projectEvents.notifyChanged();
          // Les identifiants Jenkins saisis pour le test sont conservés sur le
          // projet, afin que la vérification ultérieure dispose des mêmes.
          if (this.auth.isAdmin && this.jenkinsCredUsername && this.jenkinsCredToken) {
            this.api.updateJenkinsCredentials(p.id, this.jenkinsCredUsername, this.jenkinsCredToken)
              .subscribe({
              /** Traite le résultat reçu et actualise les données locales. */
              next: () => {},
              /** Traite l’erreur reçue et termine le suivi de la demande. */
              error: () => {} });
          }
          // Création terminée : on rend la main sur la liste des projets.
          // Les identifiants Jenkins se posent ensuite en rouvrant le projet
          // en modification — ils ne sont de toute façon pas saisissables
          // tant que le projet n'existe pas.
          this.form.markAsPristine();
          this.router.navigate(['/projects']);
          return;
        }
        this.validateProject();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (e: any) => {
        this.loading = false;
        this.saveError = userHttpError(e, 'Impossible d’enregistrer le projet. Vérifiez les champs puis réessayez.');
      }
    });
  }

  /** Enregistre Jenkins identifiants. */
  saveJenkinsCredentials() {
    if (!this.projectId || !this.jenkinsCredUsername || !this.jenkinsCredToken) return;
    this.jenkinsCredBusy = true;
    this.jenkinsCredMessage = '';
    this.api.updateJenkinsCredentials(this.projectId, this.jenkinsCredUsername, this.jenkinsCredToken).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: () => {
        this.jenkinsCredBusy = false;
        this.jenkinsCredSuccess = true;
        this.jenkinsCredMessage = 'Connexion Jenkins vérifiée.';
        this.jenkinsCredentialConfigured = true;
        // Le token n'est jamais reconservé côté client une fois envoyé.
        this.jenkinsCredUsername = '';
        this.jenkinsCredToken = '';
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (e: any) => {
        this.jenkinsCredBusy = false;
        this.jenkinsCredSuccess = false;
        this.jenkinsCredMessage = userHttpError(e, 'Vérifiez les identifiants Jenkins puis réessayez.');
        this.jenkinsCredToken = '';
      },
    });
  }

  /** Teste la configuration saisie. Fonctionne avant comme après l'enregistrement : le serveur accepte une configuration qui n'existe pas encore en base. */
  testerConfiguration() {
    if (this.testEnCours) return;
    this.appliquerSuggestions();
    // On exige d'abord une saisie formellement valide : tester une URL vide
    // n'apprendrait rien.
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.champsEnFaute = this.collecterChampsEnFaute();
      this.saveError = this.champsEnFaute.length === 1
        ? 'Un champ doit être corrigé avant de pouvoir tester.'
        : `${this.champsEnFaute.length} champs doivent être corrigés avant de pouvoir tester.`;
      if (this.champsEnFaute.length) this.activeSection = this.champsEnFaute[0].section;
      return;
    }
    this.testEnCours = true;
    this.testErreur = '';
    this.test = null;
    this.saveError = '';
    const v = this.form.getRawValue() as any;
    this.api.checkProjectConfig({
      jenkinsInternalUrl: v.jenkinsInternalUrl || '',
      jenkinsJobName:     v.jenkinsJobName || '',
      jenkinsJobPath:     v.jenkinsJobPath || '',
      jenkinsUsername:    this.jenkinsCredUsername || '',
      jenkinsToken:       this.jenkinsCredToken || '',
      sonarqubeUrl:       v.sonarqubeUrl || '',
      sonarqubeKey:       v.sonarqubeKey || '',
      githubRepo:         v.githubRepo || '',
    }).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (r: any) => { this.testEnCours = false; this.test = r; },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (e: any) => {
        this.testEnCours = false;
        this.testErreur = userHttpError(e, 'Le test de connexion n’a pas pu être exécuté.');
      },
    });
  }

  /** Regroupe les contrôles par état, pour l'affichage. */
  controlesParEtat(etat: 'ok' | 'ko' | 'skip') {
    return (this.test?.controles || []).filter((c: any) => c.etat === etat);
  }

  /** Valide le projet. */
  validateProject() {
    if (!this.projectId) return;
    this.validating = true;
    this.validationResult = null;
    this.api.validateProject(this.projectId).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next:  (r: any) => { this.validating = false; this.validationResult = r; },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: ()       => { this.validating = false; this.validationResult = { overallValid: false, results: {} }; }
    });
  }

  /** Revient à la page précédente. */
  goBack()            { this.router.navigate(this.isEdit ? ['/projects', this.projectId] : ['/projects']); }
  /** Vérifie la présence de non enregistré modifications. */
  hasUnsavedChanges() { return !!this.form?.dirty && !this.saveSuccess; }
  /** Signale les modifications non enregistrées. */
  @HostListener('window:beforeunload', ['$event'])
  warnUnsaved(event: BeforeUnloadEvent) { if (this.form?.dirty && !this.saveSuccess) event.preventDefault(); }
  /** Définit Section. */
  setSection(id: string) { this.activeSection = id; }

  /** État de connexion par outil, en QUATRE catégories. */
  connexions(): { nom: string; statut: 'ok' | 'warn' | 'unknown' | 'na'; message: string }[] {
    const r = this.validationResult?.results || {};
    /** Déclenche le test de connexion configuré. */
    const teste = (cle: string, absent: string) => {
      const v = r[cle];
      if (!v) return { statut: 'unknown' as const, message: absent };
      return v.valid
        ? { statut: 'ok' as const,   message: v.message || 'Connexion établie' }
        : { statut: 'warn' as const, message: v.message || 'Connexion impossible' };
    };
    const jenkins = teste('jenkins',  'Non vérifié — aucun identifiant Jenkins enregistré pour ce projet');
    const sonar   = teste('sonarqube','Non vérifié — aucun jeton SonarQube enregistré pour ce projet');
    return [
      { nom: 'Jenkins',   ...jenkins },
      { nom: 'SonarQube', ...sonar },
      { nom: 'GitHub',    statut: 'unknown',
        message: 'Non vérifié — la plateforme n’interroge pas GitHub depuis cet écran' },
      { nom: 'Trivy',     statut: 'na',
        message: 'Sans objet — scanner exécuté par le pipeline, aucune connexion à établir' },
      { nom: 'OWASP Dependency-Check', statut: 'na',
        message: 'Sans objet — scanner exécuté par le pipeline, aucune connexion à établir' },
      { nom: 'ZAP',       statut: 'na',
        message: 'Sans objet — analyse dynamique lancée par le pipeline sur la cible déclarée' },
    ];
  }

  /** Vrai si au moins un outil testable a répondu favorablement. */
  auMoinsUneConnexion(): boolean {
    return this.connexions().some(c => c.statut === 'ok');
  }

  /** Vrai si un outil testable a répondu défavorablement. */
  uneConnexionEnEchec(): boolean {
    return this.connexions().some(c => c.statut === 'warn');
  }

  /** Champs invalides, ordonnés comme les onglets, avec leur raison exacte. */
  private collecterChampsEnFaute() {
    const ordre = this.sections.map(s => s.id);
    return Object.keys(this.form.controls)
      .filter(champ => this.form.get(champ)?.invalid)
      .map(champ => {
        const meta = ProjectFormComponent.CHAMPS[champ]
          ?? { label: champ, section: 'general' };
        return {
          champ,
          label: meta.label,
          section: meta.section,
          sectionLabel: this.sections.find(s => s.id === meta.section)?.label ?? meta.section,
          raison: this.raison(champ, this.form.get(champ)?.errors ?? {}),
        };
      })
      .sort((a, b) => ordre.indexOf(a.section) - ordre.indexOf(b.section));
  }

  /** Depuis la liste d'erreurs : ouvrir l'onglet et viser le champ. */
  allerAuChamp(e: { champ: string; section: string }) {
    this.activeSection = e.section;
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[formControlName="${e.champ}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
    });
  }
  /** Renvoie les contrôles du formulaire. */
  get f()             { return this.form.controls; }
  /** Vérifie l’état suivant : invalide. */
  isInvalid(field: string) { const c = this.form.get(field); return !!(c?.invalid && (c.dirty || c.touched)); }
  /** Renvoie valide icône. */
  getValidIcon(key: string)  { if (!this.validationResult?.results?.[key]) return ''; return this.validationResult.results[key].valid ? '✓' : '✕'; }
  /** Renvoie valide Msg. */
  getValidMsg(key: string)   { return this.validationResult?.results?.[key]?.message || ''; }
}
