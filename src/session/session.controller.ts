import { Controller, Post } from '@nestjs/common';
import { SessionService } from './session.service';

@Controller('session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('create')
  createSession(): { sessionId: string } {
    const sessionId = this.sessionService.createSession();
    return { sessionId };
  }
}
