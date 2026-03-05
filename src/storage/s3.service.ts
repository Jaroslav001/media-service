import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  PutObjectAclCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class S3Service {
  private client: S3Client;
  private bucket: string;
  private cdnUrl: string;

  constructor(private config: ConfigService) {
    this.client = new S3Client({
      region: config.get<string>('s3.region')!,
      endpoint: config.get<string>('s3.endpoint')!,
      credentials: {
        accessKeyId: config.get<string>('s3.accessKeyId')!,
        secretAccessKey: config.get<string>('s3.secretAccessKey')!,
      },
      forcePathStyle: false,
    });
    this.bucket = config.get<string>('s3.bucket')!;
    this.cdnUrl = config.get<string>('s3.cdnUrl') || '';
  }

  getBucket(): string {
    return this.bucket;
  }

  getPublicUrl(objectKey: string): string {
    if (this.cdnUrl) {
      return `${this.cdnUrl.replace(/\/$/, '')}/${objectKey}`;
    }
    const endpoint = this.config.get<string>('s3.endpoint')!;
    return `${endpoint}/${this.bucket}/${objectKey}`;
  }

  async createPresignedPutUrl(
    objectKey: string,
    contentType: string,
    contentLength: number,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: contentType,
      ContentLength: contentLength,
      ACL: 'public-read',
    });

    const url = await getSignedUrl(this.client, command, { expiresIn: 1200 });
    return {
      url,
      headers: {
        'Content-Type': contentType,
        'x-amz-acl': 'public-read',
      },
    };
  }

  async createMultipartUpload(
    objectKey: string,
    contentType: string,
  ): Promise<string> {
    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: contentType,
      ACL: 'public-read',
    });

    const result = await this.client.send(command);
    return result.UploadId!;
  }

  async getPresignedPartUrl(
    objectKey: string,
    s3UploadId: string,
    partNumber: number,
    contentLength: number,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: objectKey,
      UploadId: s3UploadId,
      PartNumber: partNumber,
      ContentLength: contentLength,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn: 1200 });
    return { url, headers: {} };
  }

  async completeMultipartUpload(
    objectKey: string,
    s3UploadId: string,
    parts: Array<{ ETag: string; PartNumber: number }>,
  ): Promise<void> {
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: objectKey,
      UploadId: s3UploadId,
      MultipartUpload: { Parts: parts },
    });

    await this.client.send(command);
  }

  async abortMultipartUpload(
    objectKey: string,
    s3UploadId: string,
  ): Promise<void> {
    try {
      const command = new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: s3UploadId,
      });
      await this.client.send(command);
    } catch {
      // Gracefully ignore abort failures
    }
  }

  async listPartEtags(
    objectKey: string,
    s3UploadId: string,
  ): Promise<Record<number, string>> {
    const etags: Record<number, string> = {};
    let marker: string | undefined = undefined;
    let isTruncated = true;

    while (isTruncated) {
      const command = new ListPartsCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: s3UploadId,
        PartNumberMarker: marker,
      });

      const result = await this.client.send(command) as import('@aws-sdk/client-s3').ListPartsCommandOutput;
      for (const part of result.Parts ?? []) {
        if (part.PartNumber && part.ETag) {
          etags[part.PartNumber] = part.ETag;
        }
      }

      isTruncated = result.IsTruncated ?? false;
      marker = result.NextPartNumberMarker;
    }

    return etags;
  }

  async uploadBuffer(
    objectKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
    });

    await this.client.send(command);
  }

  async setObjectAcl(objectKey: string, acl: string): Promise<void> {
    const command = new PutObjectAclCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ACL: acl as any,
    });
    await this.client.send(command);
  }

  async downloadToFile(objectKey: string, destPath: string): Promise<void> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });

    const result = await this.client.send(command);
    const body = result.Body as Readable;

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(destPath);
      body.pipe(writeStream);
      body.on('error', reject);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
  }
}
