import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConversationStatus } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class MessagingPendingArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(MessagingPendingArchiveService.name) private readonly logger: PinoLogger,
  ) {}

  @Cron('30 3 * * *', { timeZone: 'Asia/Kolkata' })
  async archiveStalePendingScheduled(): Promise<void> {
    const n = await this.archiveStalePendingOlderThan(new Date(Date.now() - THIRTY_DAYS_MS));
    this.logger.info({ count: n }, 'archived_stale_pending_conversations');
  }

  /** Used by cron and e2e tests. */
  async archiveStalePendingOlderThan(cutoff: Date): Promise<number> {
    const res = await this.prisma.conversation.updateMany({
      where: {
        status: ConversationStatus.PENDING,
        createdAt: { lt: cutoff },
      },
      data: {
        status: ConversationStatus.ARCHIVED,
        archivedAt: new Date(),
      },
    });
    return res.count;
  }
}
