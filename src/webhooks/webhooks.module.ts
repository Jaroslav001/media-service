import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [StorageModule],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
