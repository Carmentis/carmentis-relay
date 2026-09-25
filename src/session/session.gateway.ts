import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(SessionGateway.name);

  constructor(private readonly sessionService: SessionService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected [socketId=${client.id}]`);
  }

  handleDisconnect(client: Socket) {
    const sessionClient = this.clients.get(client.id);
    if (sessionClient) {
      const { sessionId, role } = sessionClient;
      this.logger.log(`Client disconnected [socketId=${client.id}, sessionId=${sessionId}, role=${role}]`);

      // Notify the other client in the session
      const otherClient = this.findOtherClient(sessionClient);
      if (otherClient) {
        this.logger.debug(`Notifying peer of disconnection [peerId=${otherClient.socket.id}]`);
        otherClient.socket.emit('peer-disconnected');
        otherClient.socket.disconnect();
      }

      // Clean up
      this.clients.delete(client.id);

      // Delete the session when either client disconnects
      this.sessionService.deleteSession(sessionId);
      this.logger.log(`Session cleaned up [sessionId=${sessionId}]`);
    } else {
      this.logger.debug(`Client disconnected without active session [socketId=${client.id}]`);
    }
  }

  @SubscribeMessage('init')
  handleInit(client: Socket, payload: { sessionId: string }) {
    const { sessionId } = payload;
    this.logger.debug(`Init message received [socketId=${client.id}, sessionId=${sessionId}]`);

    const session = this.sessionService.getSession(sessionId);

    if (!session) {
      this.logger.warn(`Init failed: session not found [socketId=${client.id}, sessionId=${sessionId}]`);
      client.emit('error', { message: 'Session not found' });
      client.disconnect();
      return;
    }

    if (session.initiatorConnected) {
      this.logger.warn(`Init failed: session already initialized [socketId=${client.id}, sessionId=${sessionId}]`);
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
    this.logger.log(`Session initialized by client [socketId=${client.id}, sessionId=${sessionId}]`);
    client.emit('initialized', { sessionId });
  }

  @SubscribeMessage('join')
  handleJoin(client: Socket, payload: { sessionId: string }) {
    const { sessionId } = payload;
    this.logger.debug(`Join message received [socketId=${client.id}, sessionId=${sessionId}]`);

    const session = this.sessionService.getSession(sessionId);

    if (!session) {
      this.logger.warn(`Join failed: session not found [socketId=${client.id}, sessionId=${sessionId}]`);
      client.emit('error', { message: 'Session not found' });
      client.disconnect();
      return;
    }

    if (!session.initiatorConnected) {
      this.logger.warn(`Join failed: session not yet initialized [socketId=${client.id}, sessionId=${sessionId}]`);
      client.emit('error', { message: 'Session not yet initialized' });
      client.disconnect();
      return;
    }

    if (session.joinerConnected) {
      this.logger.warn(`Join failed: session already has a joiner [socketId=${client.id}, sessionId=${sessionId}]`);
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
    this.logger.log(`Client joined session [socketId=${client.id}, sessionId=${sessionId}]`);
    client.emit('joined', { sessionId });

    // Check if session is ready (both clients connected)
    if (this.sessionService.isSessionReady(sessionId)) {
      this.logger.log(`Session ready: both clients connected [sessionId=${sessionId}]`);
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
      this.logger.warn(`Message from unknown client [socketId=${client.id}]`);
      return;
    }

    // Forward message to the other client in the session
    const otherClient = this.findOtherClient(sessionClient);
    if (otherClient) {
      this.logger.debug(`Message forwarded [from=${client.id}, to=${otherClient.socket.id}, sessionId=${sessionClient.sessionId}]`);
      otherClient.socket.emit('message', payload);
    } else {
      this.logger.warn(`Message forwarding failed: peer not found [socketId=${client.id}, sessionId=${sessionClient.sessionId}]`);
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
