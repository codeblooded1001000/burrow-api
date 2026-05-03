import { Controller, Get, Query } from '@nestjs/common';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BrowseService } from './browse.service';
import { BrowseQueryDto } from './schemas/browse.schemas';

@Controller('browse')
export class BrowseController {
  constructor(private readonly browse: BrowseService) {}

  @Get('flats')
  browseFlats(@CurrentUser() user: UserDto, @Query() query: BrowseQueryDto) {
    return this.browse.browseFlats(user, query);
  }

  @Get('flatmates')
  browseFlatmates(@CurrentUser() user: UserDto, @Query() query: BrowseQueryDto) {
    return this.browse.browseFlatmates(user, query);
  }
}
