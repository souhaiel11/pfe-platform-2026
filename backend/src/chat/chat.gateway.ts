// Passerelle Socket.IO (namespace /chat) pour la diffusion en temps réel des messages du widget ChatOps à tous les clients connectés.
import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway {
  @WebSocketServer() server: Server;

  /** Rediffuse immédiatement un message reçu à tous les clients connectés, horodaté à la réception. */
  @SubscribeMessage('message')
  handleMessage(@MessageBody() data: any) {
    this.server.emit('message', { ...data, timestamp: new Date() });
  }
}
