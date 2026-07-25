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
  newUser   = { username: '', email: '', password: '', role: 'USER' };

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
        this.toast.success('Utilisateur créé', this.newUser.username);
        this.showModal = false;
        this.newUser = { username: '', email: '', password: '', role: 'USER' };
        this.load();
      },
      error: () => this.toast.error('Erreur', 'Impossible de créer l\'utilisateur')
    });
  }

  deleteUser(u: any) {
    if (!confirm(`Supprimer l'utilisateur "${u.username}" ?`)) return;
    this.api.deleteUser(u.id).subscribe({
      next: () => { this.toast.success('Utilisateur supprimé'); this.load(); },
      error: () => this.toast.error('Erreur', 'Impossible de supprimer l\'utilisateur')
    });
  }
}
