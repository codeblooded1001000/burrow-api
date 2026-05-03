import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { MessageEvent } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Subject, interval, merge, finalize, map, Observable } from 'rxjs';

/** Payloads pushed to connected clients (JSON `data` field of SSE). */
export type MessagingSsePayload =
  | { type: 'message_new'; conversationId: string; data: Record<string, unknown> }
  | {
      type: 'message_read';
      data: { conversationId: string; upToMessageId?: string; readerId: string };
    }
  | { type: 'number_share_requested'; data: Record<string, unknown> }
  | { type: 'number_share_responded'; data: { requestId: string; status: string } }
  | { type: 'conversation_updated'; data: { conversationId: string; lastMessageAt: string | null } }
  | { type: 'request_received'; data: { conversationId: string; fromUserId: string; intro: string } }
  | { type: 'request_accepted'; data: { conversationId: string; byUserId: string } }
  | { type: 'request_rejected'; data: { conversationId: string; byUserId: string } }
  | { type: 'keepalive' };

/**
 * In-memory pub/sub for SSE. TODO: when scaling beyond one API instance, back this with Redis pub/sub
 * and keep a thin local subscriber map per process.
 */
@Injectable()
export class SseService implements OnModuleDestroy {
  private readonly subscribers = new Map<string, Set<Subject<MessagingSsePayload>>>();
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(@InjectPinoLogger(SseService.name) private readonly logger: PinoLogger) {
    this.cleanupTimer = setInterval(() => {
      this.cleanupDeadSubscribers();
    }, 30_000);
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const [, set] of this.subscribers) {
      for (const s of set) {
        s.complete();
      }
    }
    this.subscribers.clear();
  }

  /** Stream of `MessageEvent` for Nest `@Sse()` — includes JSON keepalive every 25s for proxies. */
  subscribe(userId: string): Observable<MessageEvent> {
    const subject = new Subject<MessagingSsePayload>();
    let set = this.subscribers.get(userId);
    if (!set) {
      set = new Set();
      this.subscribers.set(userId, set);
    }
    set.add(subject);

    const heartbeat = interval(25_000).pipe(
      map(
        (): MessageEvent => ({
          data: { type: 'keepalive' } satisfies MessagingSsePayload,
        }),
      ),
    );

    const events = new Observable<MessageEvent>((sub) => {
      const subSubscription = subject.subscribe({
        next: (payload) => {
          sub.next({ data: payload });
        },
        error: (err) => {
          sub.error(err);
        },
        complete: () => {
          sub.complete();
        },
      });
      return () => {
        subSubscription.unsubscribe();
      };
    });

    return merge(heartbeat, events).pipe(
      finalize(() => {
        const s = this.subscribers.get(userId);
        if (s) {
          s.delete(subject);
          if (s.size === 0) this.subscribers.delete(userId);
        }
        subject.complete();
        this.logger.debug({ userId }, 'sse_subscriber_closed');
      }),
    );
  }

  publish(userId: string, payload: MessagingSsePayload): void {
    const set = this.subscribers.get(userId);
    if (!set) return;
    for (const s of set) {
      if (!s.closed) s.next(payload);
    }
  }

  private cleanupDeadSubscribers(): void {
    for (const [uid, set] of this.subscribers) {
      for (const s of [...set]) {
        if (s.closed) set.delete(s);
      }
      if (set.size === 0) this.subscribers.delete(uid);
    }
  }
}
