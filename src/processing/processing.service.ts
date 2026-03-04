import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { S3Service } from '../storage/s3.service.js';
import { ImageProcessor } from './image.processor.js';
import { VideoProcessor } from './video.processor.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import Redis from 'ioredis';

const DEFAULT_PRESETS = ['title', 'thumb', 'preview', 'blurred_thumb'];

export interface ProcessingJobData {
  fileId: string;
  preset: string;
}

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);

  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
    private imageProcessor: ImageProcessor,
    private videoProcessor: VideoProcessor,
    private webhooks: WebhooksService,
    @Inject(REDIS_CLIENT) private redis: Redis,
    @InjectQueue('media-processing') private processingQueue: Queue,
  ) {}

  async startProcessing(fileId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: { conversions: true },
    });

    if (!file) {
      this.logger.warn(`File ${fileId} not found — skipping processing`);
      return;
    }

    const meta = (file.metadata as Record<string, any>) ?? {};
    const presets = Array.isArray(meta.presets) && meta.presets.length > 0
      ? meta.presets as string[]
      : DEFAULT_PRESETS;

    // For videos, add poster preset
    const isVideo = file.mimeType.startsWith('video/');
    const allPresets = isVideo
      ? [...new Set([...presets, 'poster'])]
      : presets;

    // Create Conversion rows
    for (const preset of allPresets) {
      const conversionKey = this.buildConversionKey(file.objectKey, preset);
      await this.prisma.conversion.upsert({
        where: { fileId_preset: { fileId, preset } },
        create: {
          fileId,
          preset,
          objectKey: conversionKey,
          mimeType: 'image/jpeg',
          status: 'PENDING',
        },
        update: { status: 'PENDING', errorMessage: null },
      });
    }

    // Publish status event
    await this.publishEvent(file.accountId, 'file:status', {
      file_id: file.id,
      external_ref: file.externalRef,
      status: 'processing',
    });

    // Queue jobs
    for (const preset of allPresets) {
      await this.processingQueue.add('process-conversion', {
        fileId,
        preset,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
    }
  }

  async processConversion(fileId: string, preset: string): Promise<void> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) return;

    const conversion = await this.prisma.conversion.findUnique({
      where: { fileId_preset: { fileId, preset } },
    });
    if (!conversion) return;

    await this.prisma.conversion.update({
      where: { id: conversion.id },
      data: { status: 'PROCESSING' },
    });

    try {
      const isVideo = file.mimeType.startsWith('video/');
      let result: { buffer: Buffer; width?: number; height?: number };

      if (preset === 'poster' && isVideo) {
        result = await this.videoProcessor.extractPosterFrame(this.s3, file.objectKey);
      } else {
        // For videos, use poster as source (extract first)
        const sourceKey = isVideo
          ? this.buildConversionKey(file.objectKey, 'poster')
          : file.objectKey;

        result = await this.imageProcessor.processPreset(
          this.s3,
          isVideo ? sourceKey : file.objectKey,
          preset,
        );
      }

      // Upload result
      await this.s3.uploadBuffer(conversion.objectKey, result.buffer, 'image/jpeg');

      // Update conversion record
      await this.prisma.conversion.update({
        where: { id: conversion.id },
        data: {
          status: 'READY',
          sizeBytes: BigInt(result.buffer.length),
          width: result.width ?? null,
          height: result.height ?? null,
        },
      });

      // Publish conversion status
      await this.publishEvent(file.accountId, 'conversion:status', {
        file_id: fileId,
        external_ref: file.externalRef,
        preset,
        status: 'ready',
        url: this.s3.getPublicUrl(conversion.objectKey),
        width: result.width,
        height: result.height,
      });
    } catch (err: any) {
      this.logger.error(`Conversion failed: ${fileId}/${preset}`, err.message);

      await this.prisma.conversion.update({
        where: { id: conversion.id },
        data: { status: 'FAILED', errorMessage: err.message },
      });

      await this.publishEvent(file.accountId, 'conversion:status', {
        file_id: fileId,
        external_ref: file.externalRef,
        preset,
        status: 'failed',
        error: err.message,
      });
    }

    // Check if all conversions are done
    await this.checkAllConversionsDone(fileId);
  }

  private async checkAllConversionsDone(fileId: string): Promise<void> {
    const conversions = await this.prisma.conversion.findMany({
      where: { fileId },
    });

    const allDone = conversions.every(
      (c) => c.status === 'READY' || c.status === 'FAILED',
    );

    if (!allDone) return;

    const anyFailed = conversions.some((c) => c.status === 'FAILED');
    const finalStatus = anyFailed ? 'FAILED' : 'READY';

    const file = await this.prisma.file.update({
      where: { id: fileId },
      data: {
        status: finalStatus,
        ...(anyFailed ? { errorMessage: 'One or more conversions failed' } : {}),
      },
      include: { conversions: true },
    });

    const eventName = finalStatus === 'READY' ? 'file:ready' : 'file:failed';

    // Build conversions map for event
    const convMap: Record<string, any> = {};
    for (const c of conversions) {
      convMap[c.preset] = {
        url: this.s3.getPublicUrl(c.objectKey),
        width: c.width,
        height: c.height,
        status: c.status.toLowerCase(),
      };
    }

    await this.publishEvent(file.accountId, eventName, {
      file_id: file.id,
      external_ref: file.externalRef,
      status: finalStatus.toLowerCase(),
      conversions: convMap,
    });

    // Fire webhook
    const meta = (file.metadata as Record<string, any>) ?? {};
    await this.webhooks.deliver(file, conversions, meta.callback_url);
  }

  private buildConversionKey(objectKey: string, preset: string): string {
    const dir = objectKey.substring(0, objectKey.lastIndexOf('/'));
    const filename = objectKey.substring(objectKey.lastIndexOf('/') + 1);
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
    const normalizedDir = dir || '';
    const basePath = normalizedDir
      ? `${normalizedDir}/c/${nameWithoutExt}`
      : `c/${nameWithoutExt}`;

    return `${basePath}_${preset}.jpg`;
  }

  private async publishEvent(
    accountId: string,
    name: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.redis.publish(
        'events:broadcast',
        JSON.stringify({
          room: `account:${accountId}`,
          name,
          payload,
        }),
      );
    } catch (err: any) {
      this.logger.error(`Failed to publish ${name} event`, err.message);
    }
  }
}
