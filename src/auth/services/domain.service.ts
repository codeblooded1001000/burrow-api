import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { STATIC_EMAIL_BLOCKLIST } from '../data/email-blocklist';

function loadDisposableDomains(): ReadonlySet<string> {
  try {
    // package main is index.json (string[])
    /* eslint-disable @typescript-eslint/no-require-imports -- JSON entrypoint */
    const list = require('disposable-email-domains') as string[];
    /* eslint-enable @typescript-eslint/no-require-imports */
    return new Set(list.map((d) => d.toLowerCase()));
  } catch {
    return new Set<string>();
  }
}

export type DomainCheckResult = 'allow' | 'block' | 'unknown';

@Injectable()
export class DomainService implements OnModuleInit {
  private readonly log = new Logger(DomainService.name);
  private allowDomains = new Set<string>();
  private readonly staticBlock = new Set(STATIC_EMAIL_BLOCKLIST.map((d) => d.toLowerCase()));
  private readonly disposable = loadDisposableDomains();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.refreshAllowlist();
    } catch (err: unknown) {
      this.log.warn({ err }, 'Company allowlist could not be loaded; continuing with empty DB allowlist');
      this.allowDomains = new Set();
    }
  }

  async refreshAllowlist(): Promise<void> {
    const rows = await this.prisma.companyAllowlist.findMany({
      where: { isActive: true },
      select: { domain: true },
    });
    this.allowDomains = new Set(rows.map((r) => r.domain.toLowerCase()));
  }

  isBlocklisted(email: string): boolean {
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    if (this.staticBlock.has(domain)) return true;
    if (this.disposable.has(domain)) return true;
    return false;
  }

  isAllowlisted(email: string): boolean {
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    return this.allowDomains.has(domain);
  }

  checkSignupDomain(email: string): DomainCheckResult {
    if (this.isBlocklisted(email)) return 'block';
    if (this.isAllowlisted(email)) return 'allow';
    return 'unknown';
  }

  companyNameFromEmail(email: string): string {
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    const parts = domain.split('.');
    const head = parts[0] ?? domain;
    if (!head) return domain;
    return head.charAt(0).toUpperCase() + head.slice(1);
  }
}
