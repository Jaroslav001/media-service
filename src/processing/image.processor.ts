import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { S3Service } from '../storage/s3.service.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface PresetConfig {
  width: number;
  height: number;
  fit: 'cover' | 'inside';
  quality: number;
  blur?: number;
}

const PRESETS: Record<string, PresetConfig> = {
  title: { width: 450, height: 600, fit: 'cover', quality: 100 },
  thumb: { width: 300, height: 300, fit: 'cover', quality: 100 },
  preview: { width: 1600, height: 1600, fit: 'inside', quality: 100 },
  blurred_thumb: { width: 300, height: 300, fit: 'cover', quality: 80, blur: 12 },
};

@Injectable()
export class ImageProcessor {
  private readonly logger = new Logger(ImageProcessor.name);

  async processPreset(
    s3: S3Service,
    objectKey: string,
    preset: string,
  ): Promise<{ buffer: Buffer; width?: number; height?: number }> {
    const config = PRESETS[preset];
    if (!config) {
      throw new Error(`Unknown preset: ${preset}`);
    }

    const tmpDir = path.join(os.tmpdir(), 'media-processing');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const tmpSource = path.join(tmpDir, `src-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    try {
      await s3.downloadToFile(objectKey, tmpSource);

      let pipeline = sharp(tmpSource);

      if (config.fit === 'cover') {
        pipeline = pipeline.resize(config.width, config.height, { fit: 'cover' });
      } else {
        pipeline = pipeline.resize(config.width, config.height, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      if (config.blur) {
        pipeline = pipeline.blur(config.blur);
      }

      pipeline = pipeline.jpeg({ quality: config.quality });

      const buffer = await pipeline.toBuffer();
      const metadata = await sharp(buffer).metadata();

      return {
        buffer,
        width: metadata.width,
        height: metadata.height,
      };
    } finally {
      if (fs.existsSync(tmpSource)) {
        fs.unlinkSync(tmpSource);
      }
    }
  }
}
