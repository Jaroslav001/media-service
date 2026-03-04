import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import configuration from './config/configuration.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AuthModule } from './auth/auth.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { ProcessingModule } from './processing/processing.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { FilesModule } from './files/files.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('redis.host'),
          port: config.get('redis.port'),
          db: config.get('redis.db'),
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    StorageModule,
    UploadsModule,
    ProcessingModule,
    WebhooksModule,
    FilesModule,
    HealthModule,
  ],
})
export class AppModule {}
