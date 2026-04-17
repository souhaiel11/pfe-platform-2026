// incidents.gateway.ts
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/incidents' })
export class IncidentsGateway {
  @WebSocketServer() server: Server;
  emit(event: string, data: any) { this.server.emit(event, data); }
}
