import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  async get(@Res({ passthrough: false }) res: Response): Promise<void> {
    const { httpStatus, body } = await this.health.getHealth();
    res.status(httpStatus).json(body);
  }
}
