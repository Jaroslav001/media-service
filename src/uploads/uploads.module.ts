import { Module, forwardRef } from '@nestjs/common';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { ProcessingModule } from '../processing/processing.module.js';

@Module({
  imports: [StorageModule, forwardRef(() => ProcessingModule)],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
