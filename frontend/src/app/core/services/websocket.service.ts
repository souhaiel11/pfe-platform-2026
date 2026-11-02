// Connexion WebSocket brute vers le backend (hors Socket.IO) pour recevoir les mises à jour d'incidents en temps réel.
import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {
  private ws: WebSocket | null = null;
  private incidentUpdatesSubject = new Subject<any>();
  incidentUpdates$ = this.incidentUpdatesSubject.asObservable();

  /** Ouvre la connexion WebSocket vers le backend et republie chaque message reçu sur incidentUpdates$ ; se reconnecte automatiquement après 5s en cas de coupure. */
  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(environment.wsUrl);
      /** Traite le message reçu sur la connexion temps réel. */
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.incidentUpdatesSubject.next(data);
        } catch {}
      };
      /** Traite l’erreur de connexion au service. */
      this.ws.onerror = () => {};
      /** Actualise l’état après la fermeture de la connexion. */
      this.ws.onclose = () => setTimeout(() => this.connect(), 5000);
    } catch {}
  }

  /** Ferme la connexion WebSocket et libère la référence. */
  disconnect() {
    this.ws?.close();
    this.ws = null;
  }

  /** Ferme proprement la connexion quand le service est détruit. */
  ngOnDestroy() { this.disconnect(); }
}
