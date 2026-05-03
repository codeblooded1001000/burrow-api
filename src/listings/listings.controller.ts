import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { CurrentUser } from '../common/decorators/current-user.decorator';

function prismaRoleFromDto(user: UserDto): Role {
  if (user.role === 'LISTER') return Role.LISTER;
  if (user.role === 'SEEKER') return Role.SEEKER;
  if (user.role === 'BOTH') return Role.BOTH;
  return Role.ONBOARDING;
}
import { PhotoUploadUrlRequestBodyDto } from '../uploads/schemas/uploads.schemas';
import { UploadsService } from '../uploads/uploads.service';
import { ListingPatchBodyDto, ListingPutBodyDto } from './schemas/listings.schemas';
import { ListingsService } from './listings.service';

@Controller('listings')
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly uploads: UploadsService,
  ) {}

  @Get('me')
  getMine(@CurrentUser() user: UserDto) {
    return this.listings.getMine(user.id);
  }

  @Post('me')
  @HttpCode(HttpStatus.CREATED)
  createMine(@CurrentUser() user: UserDto, @Body() dto: ListingPutBodyDto) {
    return this.listings.createMine(user.id, prismaRoleFromDto(user), dto);
  }

  @Put('me')
  putMine(@CurrentUser() user: UserDto, @Body() dto: ListingPutBodyDto) {
    return this.listings.putMine(user.id, prismaRoleFromDto(user), dto);
  }

  @Patch('me')
  patchMine(@CurrentUser() user: UserDto, @Body() dto: ListingPatchBodyDto) {
    return this.listings.patchMine(user.id, prismaRoleFromDto(user), dto);
  }

  @Delete('me')
  deleteMine(@CurrentUser() user: UserDto) {
    return this.listings.deactivateMine(user.id, prismaRoleFromDto(user));
  }

  @Post('me/photos/upload-url')
  uploadUrl(@CurrentUser() user: UserDto, @Body() dto: PhotoUploadUrlRequestBodyDto) {
    const role = user.role;
    if (role !== 'LISTER' && role !== 'BOTH') {
      throw new HttpException(
        { error: { code: 'FORBIDDEN', message: 'Only listers can upload listing photos.' } },
        HttpStatus.FORBIDDEN,
      );
    }
    return this.uploads.createListingPhotoUploadUrl(user.id, dto.contentType, dto.sizeBytes);
  }

  @Get(':listingId')
  getPublic(@CurrentUser() viewer: UserDto, @Param('listingId') listingId: string) {
    return this.listings.getPublic(viewer.id, listingId);
  }
}
