import { Injectable, Logger } from '@nestjs/common';
import { S3Service } from '../storage/s3.service.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

@Injectable()
export class VideoProcessor {
  private readonly logger = new Logger(VideoProcessor.name);

  async extractPosterFrame(
    s3: S3Service,
    objectKey: string,
  ): Promise<{ buffer: Buffer; width?: number; height?: number }> {
    const tmpDir = path.join(os.tmpdir(), 'media-processing');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const tmpSource = path.join(tmpDir, `vid-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const tmpPoster = `${tmpSource}-poster.jpg`;

    try {
      await s3.downloadToFile(objectKey, tmpSource);

      // Extract frame at 00:00:01 using ffmpeg
      await execFileAsync('ffmpeg', [
        '-i', tmpSource,
        '-ss', '00:00:01',
        '-vframes', '1',
        '-q:v', '2',
        '-y',
        tmpPoster,
      ], { timeout: 60000 });

      if (!fs.existsSync(tmpPoster)) {
        throw new Error('ffmpeg did not produce a poster frame');
      }

      const buffer = fs.readFileSync(tmpPoster);
      const metadata = await sharp(buffer).metadata();

      return {
        buffer,
        width: metadata.width,
        height: metadata.height,
      };
    } finally {
      if (fs.existsSync(tmpSource)) fs.unlinkSync(tmpSource);
      if (fs.existsSync(tmpPoster)) fs.unlinkSync(tmpPoster);
    }
  }

  async extractMetadata(
    s3: S3Service,
    objectKey: string,
  ): Promise<{
    duration_seconds?: number;
    bitrate?: number;
    codec?: string;
    width?: number;
    height?: number;
  }> {
    const tmpDir = path.join(os.tmpdir(), 'media-processing');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const tmpSource = path.join(tmpDir, `meta-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    try {
      await s3.downloadToFile(objectKey, tmpSource);

      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        tmpSource,
      ], { timeout: 30000 });

      const decoded = JSON.parse(stdout);
      const streams = Array.isArray(decoded?.streams) ? decoded.streams : [];
      const format = decoded?.format ?? {};

      const videoStream = streams.find((s: any) => s?.codec_type === 'video');

      return {
        duration_seconds: format.duration ? parseFloat(format.duration) : undefined,
        bitrate: format.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
        codec: videoStream?.codec_name ?? undefined,
        width: videoStream?.width ? parseInt(videoStream.width, 10) : undefined,
        height: videoStream?.height ? parseInt(videoStream.height, 10) : undefined,
      };
    } finally {
      if (fs.existsSync(tmpSource)) fs.unlinkSync(tmpSource);
    }
  }
}
