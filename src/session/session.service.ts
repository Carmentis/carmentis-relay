import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

export interface Session {
  id: string;
  initiatorConnected: boolean;
  joinerConnected: boolean;
  createdAt: Date;
}

@Injectable()
export class SessionService {
  private sessions = new Map<string, Session>();

  createSession(): string {
    const sessionId = randomBytes(16).toString('hex');
    this.sessions.set(sessionId, {
      id: sessionId,
      initiatorConnected: false,
      joinerConnected: false,
      createdAt: new Date(),
    });
    return sessionId;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  setInitiatorConnected(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.initiatorConnected = true;
    return true;
  }

  setJoinerConnected(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.joinerConnected = true;
    return true;
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  isSessionReady(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session ? session.initiatorConnected && session.joinerConnected : false;
  }
}
