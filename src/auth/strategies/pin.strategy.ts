import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Argon2id only — parameters fixed per BURROW_MASTER_SPEC. Never log raw PINs. */
@Injectable()
export class PinStrategy {
  async hash(pin: string): Promise<string> {
    return argon2.hash(pin, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  async verify(hash: string, pin: string): Promise<boolean> {
    return argon2.verify(hash, pin);
  }
}
