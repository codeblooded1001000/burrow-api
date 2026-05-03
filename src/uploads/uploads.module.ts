import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Global()
@Module({
  imports: [RedisModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
