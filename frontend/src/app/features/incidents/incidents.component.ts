import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-incidents',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './incidents.component.html',
  styleUrls: ['./incidents.component.scss'],
})
export class IncidentsComponent implements OnInit {
  incidents: any[] = [];
  loading = false;
  total = 0;
  page  = 0;
  size  = 15;
  totalPages = 0;

  filters = { severity: '', status: '', source: '', search: '' };
  private searchTimer: any;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    const params = {
      ...this.filters,
      page: this.page,
      size: this.size
    };
    this.api.getIncidents(params).subscribe({
      next: (res: any) => {
        this.incidents   = res.content || res;
        this.total       = res.totalElements || this.incidents.length;
        this.totalPages  = res.totalPages || 1;
        this.loading     = false;
      },
      error: () => {
        this.toast.error('Erreur', 'Impossible de charger les incidents');
        this.loading = false;
      }
    });
  }

  onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 400);
  }

  resetFilters() {
    this.filters = { severity: '', status: '', source: '', search: '' };
    this.page = 0;
    this.load();
  }

  prevPage() { if (this.page > 0) { this.page--; this.load(); } }
  nextPage() { if (this.page < this.totalPages - 1) { this.page++; this.load(); } }
}
