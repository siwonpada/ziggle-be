import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { FileModule } from './file/file.module';
import { UserModule } from './user/user.module';
import { TagModule } from './tag/tag.module';
import { NoticeModule } from './notice/notice.module';
import { DocumentModule } from './document/document.module';
import { ImageModule } from './image/image.module';
import { CrawlModule } from './crawl/crawl.module';
import { GroupModule } from './group/group.module';
import { FcmModule } from './fcm/fcm.module';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      ignoreEnvFile: false,
    }),
    FileModule,
    UserModule,
    TagModule,
    NoticeModule,
    DocumentModule,
    ImageModule,
    CrawlModule,
    GroupModule,
    FcmModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: configService.getOrThrow<number>('REDIS_PORT'),
        },
      }),
    }),
    AiModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
