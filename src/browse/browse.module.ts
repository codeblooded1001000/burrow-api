import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { RedisModule } from '../redis/redis.module';
import { BrowseController } from './browse.controller';
import { BrowseService } from './browse.service';

@Module({
  imports: [PrismaModule, RedisModule, ListingsModule, ProfilesModule],
  controllers: [BrowseController],
  providers: [BrowseService],
})
export class BrowseModule {}
