// Gère l’affichage et les actions de administrateur.
import { userHttpError } from '../../core/http-error-message';
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { FrenchDatePipe } from '../../shared/french-date.pipe';
import { PresentationLabelPipe } from '../../shared/presentation-label.pipe';
import { ZoneLabelComponent } from '../../shared/zone-label/zone-label.component';

/**
 * Page d'administration des utilisateurs : liste, création et suppression
 * des comptes de la plateforme.
 */
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, FrenchDatePipe, PresentationLabelPipe, ZoneLabelComponent],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss'],
})
export class AdminComponent implements OnInit {
  users: any[] = [];
  loadError = '';
  loading   = false;
  showModal = false;
  saving = false;
  newUser   = { name: '', email: '', password: '', role: 'developer' };

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private api: ApiService, private toast: ToastService) {}

  /** Charge la liste des utilisateurs dès l'affichage de la page. */
  ngOnInit() { this.load(); }

  /** Récupère tous les utilisateurs depuis l'API et met à jour l'état de chargement/erreur. */
  load() {
    this.loadError = '';
    this.loading = true;
    this.api.getUsers().subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: u => { this.users = u; this.loading = false; },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.loadError = 'Impossible de charger les utilisateurs.'; this.loading = false; }
    });
  }

  /** Crée un nouvel utilisateur à partir du formulaire, puis recharge la liste ; affiche l'erreur réelle du backend en cas d'échec. */
  createUser() {
    if (this.saving || !this.newUser.name.trim() || !this.newUser.email.trim() || !this.newUser.password) return;
    this.saving = true;
    this.api.createUser(this.newUser).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: () => {
        this.saving = false;
        this.toast.success('Utilisateur créé', this.newUser.name);
        this.showModal = false;
        this.newUser = { name: '', email: '', password: '', role: 'developer' };
        this.load();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (err: any) => { this.saving = false; this.toast.error('Erreur', userHttpError(err, 'Impossible de créer l’utilisateur. Vérifiez les champs puis réessayez.')); }
    });
  }

  /** Supprime un utilisateur après confirmation explicite, puis recharge la liste. */
  deleteUser(u: any) {
    if (!confirm(`Supprimer l'utilisateur "${u.name}" ?`)) return;
    this.api.deleteUser(u.id).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: () => { this.toast.success('Utilisateur supprimé'); this.load(); },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => this.toast.error('Erreur', 'Impossible de supprimer l\'utilisateur')
    });
  }
}
