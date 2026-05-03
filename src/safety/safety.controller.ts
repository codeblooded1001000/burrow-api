import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PostBlockBodyDto, PostReportBodyDto } from './schemas/safety.schemas';
import { SafetyService } from './safety.service';

@Controller()
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post('blocks')
  async createBlock(
    @CurrentUser() user: UserDto,
    @Body() body: PostBlockBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { isNew, ...rest } = await this.safety.blockUser(user, body);
    res.status(isNew ? HttpStatus.CREATED : HttpStatus.OK);
    return rest;
  }

  @Delete('blocks/:userId')
  @HttpCode(HttpStatus.OK)
  removeBlock(@CurrentUser() user: UserDto, @Param('userId') userId: string) {
    return this.safety.unblockUser(user, userId);
  }

  @Get('blocks')
  listBlocks(@CurrentUser() user: UserDto) {
    return this.safety.listBlocks(user);
  }

  @Post('reports')
  async createReport(
    @CurrentUser() user: UserDto,
    @Body() body: PostReportBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { isNew, ...rest } = await this.safety.createReport(user, body);
    res.status(isNew ? HttpStatus.CREATED : HttpStatus.OK);
    return rest;
  }

  @Get('reports/mine')
  myReports(@CurrentUser() user: UserDto) {
    return this.safety.listMyReports(user);
  }
}
