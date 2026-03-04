import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProcessingService } from './processing.service.js';
import { ImageProcessor } from './image.processor.js';
import { VideoProcessor } from './video.processor.js';
import { MediaProcessingWorker } from './media-processing.worker.js';
import { StorageModule } from '../storage/storage.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Module({
  imports: [
    StorageModule,
    WebhooksModule,
    BullModule.registerQueue({ name: 'media-processing' }),
    BullModule.registerQueue({ name: 'webhook-delivery' }),
  ],
  providers: [ProcessingService, ImageProcessor, VideoProcessor, MediaProcessingWorker],
  exports: [ProcessingService],
})
export class ProcessingModule {}
