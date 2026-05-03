import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminService } from './admin.service';
import {
  AdminBanUserBodyDto,
  AdminLoginBodyDto,
  AdminManualReviewsQueryDto,
  AdminReportsQueryDto,
  ManualReviewRejectBodyDto,
  PatchAdminReportBodyDto,
} from './schemas/admin.schemas';

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

@Controller('admin')
@Public()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Req() req: Request, @Body() body: AdminLoginBodyDto) {
    return this.admin.login(clientIp(req), body);
  }

  @Get('reports')
  @UseGuards(AdminAuthGuard)
  listReports(@Query() query: AdminReportsQueryDto) {
    return this.admin.listReports(query);
  }

  @Patch('reports/:id')
  @UseGuards(AdminAuthGuard)
  patchReport(@Param('id') id: string, @Body() body: PatchAdminReportBodyDto) {
    return this.admin.patchReport(id, body);
  }

  @Get('manual-reviews')
  @UseGuards(AdminAuthGuard)
  listManualReviews(@Query() query: AdminManualReviewsQueryDto) {
    return this.admin.listManualReviews(query);
  }

  @Post('manual-reviews/:id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  approveManualReview(@Param('id') id: string) {
    return this.admin.approveManualReview(id);
  }

  @Post('manual-reviews/:id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  rejectManualReview(@Param('id') id: string, @Body() body: ManualReviewRejectBodyDto) {
    return this.admin.rejectManualReview(id, body);
  }

  @Get('users/:userId')
  @UseGuards(AdminAuthGuard)
  getUser(@Param('userId') userId: string) {
    return this.admin.getUser(userId);
  }

  @Post('users/:userId/ban')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  banUser(@Param('userId') userId: string, @Body() body: AdminBanUserBodyDto) {
    return this.admin.banUser(userId, body);
  }
}
