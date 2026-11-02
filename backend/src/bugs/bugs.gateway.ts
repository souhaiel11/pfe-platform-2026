// Passerelle Socket.IO du module legacy "bugs" — diffuse les créations/mises à jour de bugs aux clients connectés.
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/bugs' })
export class BugsGateway {
  @WebSocketServer() server: Server;

  // Diffuse la création d'un bug à tous les clients connectés.
  emitBugCreated(bug: any) {
    this.server.emit('bug:created', bug);
  }

  // Diffuse la mise à jour d'un bug à tous les clients connectés.
  emitBugUpdated(bug: any) {
    this.server.emit('bug:updated', bug);
  }
}
