import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [StorageModule],
  controllers: [FilesController],
})
export class FilesModule {}
