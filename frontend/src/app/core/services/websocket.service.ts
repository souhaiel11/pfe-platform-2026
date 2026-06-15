import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {
  private ws: WebSocket | null = null;
  private incidentUpdatesSubject = new Subject<any>();
  incidentUpdates$ = this.incidentUpdatesSubject.asObservable();

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(environment.wsUrl);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.incidentUpdatesSubject.next(data);
        } catch {}
      };
      this.ws.onerror = () => {};
      this.ws.onclose = () => setTimeout(() => this.connect(), 5000);
    } catch {}
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }

  ngOnDestroy() { this.disconnect(); }
}
