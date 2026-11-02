// Passerelle Socket.IO des incidents — diffuse tout événement lié aux incidents aux clients connectés.
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { localizeFindingsFr } from '../common/fr-localization/fr-findings';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/incidents' })
export class IncidentsGateway {
  @WebSocketServer() server: Server;

  // Diffuse un événement nommé avec ses données à tous les clients connectés (constats francisés,
  // comme les réponses HTTP de l'interface).
  emit(event: string, data: any) { this.server.emit(event, localizeFindingsFr(data)); }
}
