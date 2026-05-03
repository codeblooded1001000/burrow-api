import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put } from '@nestjs/common';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PhotoUploadUrlRequestBodyDto } from '../uploads/schemas/uploads.schemas';
import { UploadsService } from '../uploads/uploads.service';
import { ProfilePatchBodyDto, ProfilePutBodyDto } from './schemas/profiles.schemas';
import { ProfilesService } from './profiles.service';

@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly uploads: UploadsService,
  ) {}

  @Get('me')
  getMine(@CurrentUser() user: UserDto) {
    return this.profiles.getMine(user.id);
  }

  @Post('me/photo/upload-url')
  @HttpCode(HttpStatus.OK)
  photoUploadUrl(@CurrentUser() user: UserDto, @Body() dto: PhotoUploadUrlRequestBodyDto) {
    return this.uploads.createProfilePhotoUploadUrl(user.id, dto.contentType, dto.sizeBytes);
  }

  @Put('me')
  putMine(@CurrentUser() user: UserDto, @Body() dto: ProfilePutBodyDto) {
    return this.profiles.putMine(user.id, dto);
  }

  @Patch('me')
  patchMine(@CurrentUser() user: UserDto, @Body() dto: ProfilePatchBodyDto) {
    return this.profiles.patchMine(user.id, dto);
  }

  @Get(':userId')
  getPublic(@CurrentUser() viewer: UserDto, @Param('userId') userId: string) {
    return this.profiles.getPublic(viewer.id, userId);
  }
}
