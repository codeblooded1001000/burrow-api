import { Controller, Get, MessageEvent, Sse } from '@nestjs/common';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SseService } from './sse.service';
import { MessagingService } from './messaging.service';
import type { Observable } from 'rxjs';

@Controller('messages')
export class SseMessagesController {
  constructor(
    private readonly sse: SseService,
    private readonly messaging: MessagingService,
  ) {}

  @Sse('stream')
  stream(@CurrentUser() user: UserDto): Observable<MessageEvent> {
    return this.sse.subscribe(user.id);
  }

  @Get('unread-count')
  unread(@CurrentUser() user: UserDto) {
    return this.messaging.getUnreadCount(user.id);
  }
}
