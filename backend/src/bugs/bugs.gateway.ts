import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/bugs' })
export class BugsGateway {
  @WebSocketServer() server: Server;

  emitBugCreated(bug: any) {
    this.server.emit('bug:created', bug);
  }

  emitBugUpdated(bug: any) {
    this.server.emit('bug:updated', bug);
  }
}
