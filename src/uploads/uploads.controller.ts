import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UploadConfirmBodyDto } from './schemas/uploads.schemas';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentUser() user: UserDto, @Body() body: UploadConfirmBodyDto) {
    return this.uploads.confirmUpload(user.id, body.key, body.type);
  }
}
