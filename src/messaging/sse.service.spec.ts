import { SseService } from './sse.service';
import type { PinoLogger } from 'nestjs-pino';

function mockLogger(): PinoLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;
}

describe('SseService', () => {
  let svc: SseService;

  beforeEach(() => {
    svc = new SseService(mockLogger());
  });

  afterEach(() => {
    svc.onModuleDestroy();
  });

  it('delivers published payloads to active subscriber', () => {
    const payloads: unknown[] = [];
    const sub = svc.subscribe('user-1').subscribe({
      next: (ev) => payloads.push(ev.data),
    });
    svc.publish('user-1', {
      type: 'conversation_updated',
      data: { conversationId: 'c1', lastMessageAt: null },
    });
    sub.unsubscribe();
    expect(payloads.some((p) => (p as { type?: string }).type === 'conversation_updated')).toBe(true);
  });

  it('allows unsubscribe without throwing', () => {
    const sub = svc.subscribe('user-2').subscribe();
    expect(() => {
      sub.unsubscribe();
    }).not.toThrow();
  });
});
