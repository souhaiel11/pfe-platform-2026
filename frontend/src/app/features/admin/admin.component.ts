import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss'],
})
export class AdminComponent implements OnInit {
  users: any[] = [];
  loading   = false;
  showModal = false;
  // Valeurs alignées sur l'enum backend réel (user.entity.ts::UserRole,
  // minuscules) — plus 'USER'/'ADMIN' qui ne correspondaient à rien.
  newUser   = { name: '', email: '', password: '', role: 'developer' };

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.api.getUsers().subscribe({
      next: u => { this.users = u; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  createUser() {
    this.api.createUser(this.newUser).subscribe({
      next: () => {
        this.toast.success('Utilisateur créé', this.newUser.name);
        this.showModal = false;
        this.newUser = { name: '', email: '', password: '', role: 'developer' };
        this.load();
      },
      // Remonte le vrai message backend (ex. rôle invalide, 400 explicite)
      // plutôt qu'un message générique qui masquerait la raison réelle.
      error: (err: any) => this.toast.error('Erreur', err?.error?.message || 'Impossible de créer l\'utilisateur')
    });
  }

  deleteUser(u: any) {
    if (!confirm(`Supprimer l'utilisateur "${u.name}" ?`)) return;
    this.api.deleteUser(u.id).subscribe({
      next: () => { this.toast.success('Utilisateur supprimé'); this.load(); },
      error: () => this.toast.error('Erreur', 'Impossible de supprimer l\'utilisateur')
    });
  }
}
