import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SessionService } from './session.service';

interface SessionClient {
  sessionId: string;
  role: 'initiator' | 'joiner';
  socket: Socket;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class SessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private clients = new Map<string, SessionClient>(); // socketId -> SessionClient

  constructor(private readonly sessionService: SessionService) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    const sessionClient = this.clients.get(client.id);
    if (sessionClient) {
      const { sessionId } = sessionClient;

      // Notify the other client in the session
      const otherClient = this.findOtherClient(sessionClient);
      if (otherClient) {
        otherClient.socket.emit('peer-disconnected');
        otherClient.socket.disconnect();
      }

      // Clean up
      this.clients.delete(client.id);

      // Delete the session when either client disconnects
      this.sessionService.deleteSession(sessionId);
    }
  }

  @SubscribeMessage('init')
  handleInit(client: Socket, payload: { sessionId: string }) {
    const { sessionId } = payload;
    const session = this.sessionService.getSession(sessionId);

    if (!session) {
      client.emit('error', { message: 'Session not found' });
      client.disconnect();
      return;
    }

    if (session.initiatorConnected) {
      client.emit('error', { message: 'Session already initialized' });
      client.disconnect();
      return;
    }

    // Register client as initiator
    this.clients.set(client.id, {
      sessionId,
      role: 'initiator',
      socket: client,
    });

    this.sessionService.setInitiatorConnected(sessionId);
    client.emit('initialized', { sessionId });
  }

  @SubscribeMessage('join')
  handleJoin(client: Socket, payload: { sessionId: string }) {
    const { sessionId } = payload;
    const session = this.sessionService.getSession(sessionId);

    if (!session) {
      client.emit('error', { message: 'Session not found' });
      client.disconnect();
      return;
    }

    if (!session.initiatorConnected) {
      client.emit('error', { message: 'Session not yet initialized' });
      client.disconnect();
      return;
    }

    if (session.joinerConnected) {
      client.emit('error', { message: 'Session already has a joiner' });
      client.disconnect();
      return;
    }

    // Register client as joiner
    this.clients.set(client.id, {
      sessionId,
      role: 'joiner',
      socket: client,
    });

    this.sessionService.setJoinerConnected(sessionId);
    client.emit('joined', { sessionId });

    // Check if session is ready (both clients connected)
    if (this.sessionService.isSessionReady(sessionId)) {
      // Notify both clients that the session is ready
      const initiator = this.findInitiator(sessionId);
      if (initiator) {
        initiator.socket.emit('session-ready');
      }
      client.emit('session-ready');
    }
  }

  @SubscribeMessage('message')
  handleMessage(client: Socket, payload: any) {
    const sessionClient = this.clients.get(client.id);
    if (!sessionClient) {
      return;
    }

    // Forward message to the other client in the session
    const otherClient = this.findOtherClient(sessionClient);
    if (otherClient) {
      otherClient.socket.emit('message', payload);
    }
  }

  private findOtherClient(sessionClient: SessionClient): SessionClient | undefined {
    const targetRole = sessionClient.role === 'initiator' ? 'joiner' : 'initiator';
    for (const [, client] of this.clients) {
      if (client.sessionId === sessionClient.sessionId && client.role === targetRole) {
        return client;
      }
    }
    return undefined;
  }

  private findInitiator(sessionId: string): SessionClient | undefined {
    for (const [, client] of this.clients) {
      if (client.sessionId === sessionId && client.role === 'initiator') {
        return client;
      }
    }
    return undefined;
  }
}
