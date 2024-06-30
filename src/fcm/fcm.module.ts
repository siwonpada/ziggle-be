import { Module } from '@nestjs/common';
import { FcmService } from './fcm.service';
import { ConfigModule } from '@nestjs/config';
import { FcmRepository } from './fcm.repository';
import { PrismaModule } from 'src/prisma/prisma.module';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    BullModule.registerQueue({ name: 'fcm' }),
  ],
  providers: [FcmService, FcmRepository],
  exports: [FcmService],
})
export class FcmModule {}
