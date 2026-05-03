import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MessagingBlockService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws 403 if viewer cannot message target (block graph). */
  async assertCanMessage(viewerId: string, targetUserId: string): Promise<void> {
    if (viewerId === targetUserId) {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Cannot message yourself.' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const blockedByTarget = await this.prisma.block.findFirst({
      where: { blockerUserId: targetUserId, blockedUserId: viewerId },
    });
    if (blockedByTarget) {
      throw new HttpException(
        {
          error: {
            code: 'BLOCKED_BY_USER',
            message: 'Cannot message this user.',
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }
    const viewerBlockedTarget = await this.prisma.block.findFirst({
      where: { blockerUserId: viewerId, blockedUserId: targetUserId },
    });
    if (viewerBlockedTarget) {
      throw new HttpException(
        {
          error: {
            code: 'YOU_BLOCKED_USER',
            message: 'You have blocked this user. Unblock them to send messages.',
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
