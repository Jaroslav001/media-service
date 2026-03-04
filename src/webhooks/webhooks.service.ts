import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Service } from '../storage/s3.service.js';
import axios from 'axios';
import { createHmac } from 'crypto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly defaultUrl: string;
  private readonly secret: string;

  constructor(
    private config: ConfigService,
    private s3: S3Service,
  ) {
    this.defaultUrl = config.get<string>('webhook.defaultUrl') || '';
    this.secret = config.get<string>('webhook.secret') || '';
  }

  async deliver(file: any, conversions: any[], callbackUrl?: string): Promise<void> {
    const url = callbackUrl || this.defaultUrl;
    if (!url) {
      this.logger.warn('No webhook URL configured — skipping delivery');
      return;
    }

    const event = file.status === 'READY' ? 'file.ready' : 'file.failed';

    const convMap: Record<string, any> = {};
    for (const c of conversions) {
      convMap[c.preset] = {
        url: this.s3.getPublicUrl(c.objectKey),
        width: c.width,
        height: c.height,
        status: c.status.toLowerCase(),
      };
    }

    const body = {
      event,
      file: {
        id: file.id,
        external_ref: file.externalRef,
        original_name: file.originalName,
        mime_type: file.mimeType,
        size_bytes: Number(file.sizeBytes),
        status: file.status.toLowerCase(),
        url: this.s3.getPublicUrl(file.objectKey),
        metadata: file.metadata,
        error_message: file.errorMessage ?? null,
        conversions: convMap,
      },
    };

    const bodyString = JSON.stringify(body);
    const signature = this.sign(bodyString);

    const maxRetries = 5;
    const baseDelay = 5000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await axios.post(url, body, {
          headers: {
            'Content-Type': 'application/json',
            'X-Media-Signature': `sha256=${signature}`,
            'X-Media-Event': event,
          },
          timeout: 15000,
        });

        this.logger.log(`Webhook delivered: ${event} for file ${file.id}`);
        return;
      } catch (err: any) {
        this.logger.warn(
          `Webhook delivery attempt ${attempt + 1}/${maxRetries + 1} failed: ${err.message}`,
        );

        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error(`Webhook delivery failed after ${maxRetries + 1} attempts for file ${file.id}`);
  }

  private sign(body: string): string {
    if (!this.secret) return '';
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }
}
