import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CommuteQueryDto, ValidatePlaceBodyDto } from './schemas/maps.schemas';
import { MapsService } from './maps.service';

@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get('commute')
  @HttpCode(HttpStatus.OK)
  commute(@CurrentUser() user: UserDto, @Query() query: CommuteQueryDto) {
    return this.maps.getCommute(user, query.listingId);
  }

  @Post('validate-place')
  @HttpCode(HttpStatus.OK)
  validatePlace(@CurrentUser() _user: UserDto, @Body() body: ValidatePlaceBodyDto) {
    return this.maps.validatePlace(body.placeId);
  }
}
