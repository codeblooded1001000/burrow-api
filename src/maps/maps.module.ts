import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';

@Module({
  imports: [ListingsModule, PrismaModule, RedisModule],
  controllers: [MapsController],
  providers: [MapsService],
})
export class MapsModule {}
