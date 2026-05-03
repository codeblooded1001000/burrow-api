import { Body, Controller, Delete, Get, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SessionService } from '../auth/services/session.service';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  DeleteMeBodyDto,
  PatchMePhoneBodyDto,
  PatchMeRoleBodyDto,
  PostMePhoneVerifyBodyDto,
} from './schemas/users.schemas';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly session: SessionService,
  ) {}

  @Patch('me/role')
  patchRole(@CurrentUser() user: UserDto, @Body() dto: PatchMeRoleBodyDto) {
    return this.users.patchRole(user.id, dto);
  }

  @Patch('me/phone')
  patchPhone(@CurrentUser() user: UserDto, @Body() dto: PatchMePhoneBodyDto) {
    return this.users.patchPhone(user.id, dto);
  }

  @Post('me/phone/verify')
  verifyPhone(@CurrentUser() user: UserDto, @Body() dto: PostMePhoneVerifyBodyDto) {
    return this.users.verifyPhone(user.id, dto);
  }

  @Delete('me')
  async deleteMe(
    @CurrentUser() user: UserDto,
    @Body() dto: DeleteMeBodyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.users.deleteAccount(user.id, dto.pin);
    this.session.clearSessionCookie(res);
    return { ok: true };
  }

  @Get('me/export')
  async exportData(@CurrentUser() user: UserDto, @Res() res: Response): Promise<void> {
    const payload = await this.users.exportUserData(user.id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="burrow-data-${user.id}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  }
}
