import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnonymousStrategy } from './guard/anonymous.strategy';
import { IdPGuard, IdPOptionalGuard } from './guard/idp.guard';
import { IdPStrategy } from './guard/idp.strategy';
import { IdPOptionalStrategy } from './guard/idpOptional.strategy';
import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';
import { PrismaModule } from '@lib/prisma';
import { InfoteamIdpModule } from '@lib/infoteam-idp';

@Module({
  imports: [HttpModule, ConfigModule, PrismaModule, InfoteamIdpModule],
  providers: [
    UserService,
    UserRepository,
    IdPGuard,
    IdPOptionalGuard,
    IdPStrategy,
    AnonymousStrategy,
    IdPOptionalStrategy,
  ],
  controllers: [UserController],
  exports: [UserService, IdPOptionalGuard, IdPGuard],
})
export class UserModule {}
