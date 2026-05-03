import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { MessagingBlockService } from './helpers/messaging-block.service';
import { MessagingRateLimitService } from './helpers/messaging-rate-limit.service';
import { MessagingController } from './messaging.controller';
import { MessagingPendingArchiveService } from './messaging-pending-archive.service';
import { MessagingService } from './messaging.service';
import { SseMessagesController } from './sse.controller';
import { SseService } from './sse.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [MessagingController, SseMessagesController],
  providers: [
    MessagingService,
    SseService,
    MessagingBlockService,
    MessagingRateLimitService,
    MessagingPendingArchiveService,
  ],
})
export class MessagingModule {}
