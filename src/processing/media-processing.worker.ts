import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ProcessingService, ProcessingJobData } from './processing.service.js';

@Processor('media-processing')
@Injectable()
export class MediaProcessingWorker extends WorkerHost {
  private readonly logger = new Logger(MediaProcessingWorker.name);

  constructor(private processingService: ProcessingService) {
    super();
  }

  async process(job: Job<ProcessingJobData>): Promise<void> {
    const { fileId, preset } = job.data;
    this.logger.log(`Processing conversion: ${fileId}/${preset}`);

    await this.processingService.processConversion(fileId, preset);

    this.logger.log(`Completed conversion: ${fileId}/${preset}`);
  }
}
