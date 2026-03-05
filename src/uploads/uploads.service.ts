import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { S3Service } from '../storage/s3.service.js';
import { randomBytes } from 'crypto';
import * as path from 'path';

const SINGLE_UPLOAD_MAX_BYTES = 16 * 1024 * 1024; // 16 MB
const MIN_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB
const MAX_CHUNK_SIZE = 64 * 1024 * 1024; // 64 MB
const TARGET_PART_COUNT = 200;
const MAX_PART_COUNT = 10000;
const SESSION_EXPIRY_HOURS = 24;

export interface InitiateUploadParams {
  accountId: string;
  createdBy?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  keyPrefix?: string;
  externalRef?: string;
  metadata?: Record<string, unknown>;
  presets?: string[];
  callbackUrl?: string;
}

@Injectable()
export class UploadsService {
  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
  ) {}

  async initiate(params: InitiateUploadParams) {
    const {
      accountId,
      createdBy,
      fileName,
      mimeType,
      sizeBytes,
      keyPrefix,
      externalRef,
      metadata,
      presets,
      callbackUrl,
    } = params;

    const objectKey = this.buildObjectKey(keyPrefix ?? '', fileName);
    const bucket = this.s3.getBucket();
    const isSingle = sizeBytes <= SINGLE_UPLOAD_MAX_BYTES;
    const chunkSize = isSingle ? sizeBytes : this.resolveChunkSize(sizeBytes);

    let s3UploadId: string | null = null;
    let uploadUrl: string | null = null;
    let uploadHeaders: Record<string, string> = {};

    if (isSingle) {
      const presigned = await this.s3.createPresignedPutUrl(objectKey, mimeType, sizeBytes);
      uploadUrl = presigned.url;
      uploadHeaders = presigned.headers;
    } else {
      s3UploadId = await this.s3.createMultipartUpload(objectKey, mimeType);
    }

    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);

    const file = await this.prisma.file.create({
      data: {
        accountId,
        createdBy: createdBy ?? null,
        bucket,
        objectKey,
        originalName: fileName,
        mimeType,
        sizeBytes: BigInt(sizeBytes),
        status: 'UPLOADING',
        externalRef: externalRef ?? null,
        metadata: {
          ...(metadata ?? {}),
          ...(presets ? { presets } : {}),
          ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        },
        uploadSession: {
          create: {
            s3UploadId,
            uploadMode: isSingle ? 'SINGLE' : 'MULTIPART',
            chunkSize,
            expiresAt,
          },
        },
      },
      include: { uploadSession: true },
    });

    return {
      file_id: file.id,
      object_key: file.objectKey,
      status: 'uploading',
      upload_mode: isSingle ? 'single' : 'multipart',
      chunk_size: chunkSize,
      upload_url: uploadUrl,
      upload_headers: uploadHeaders,
      uploaded_parts: [],
      bytes_uploaded: 0,
      expires_at: expiresAt.toISOString(),
    };
  }

  async getPartUrls(
    fileId: string,
    accountId: string,
    parts: Array<{ part_number: number; content_length: number }>,
  ) {
    const file = await this.getOwnedFile(fileId, accountId);
    const session = file.uploadSession;

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }
    if (session.uploadMode !== 'MULTIPART' || !session.s3UploadId) {
      throw new BadRequestException('Part URLs are only available for multipart uploads');
    }

    const items = await Promise.all(
      parts.map(async (part) => {
        const result = await this.s3.getPresignedPartUrl(
          file.objectKey,
          session.s3UploadId!,
          part.part_number,
          part.content_length,
        );
        return {
          part_number: part.part_number,
          url: result.url,
          headers: result.headers,
        };
      }),
    );

    return { items };
  }

  async complete(
    fileId: string,
    accountId: string,
    parts?: Array<{ part_number: number; etag?: string }>,
  ) {
    const file = await this.getOwnedFile(fileId, accountId);
    const session = file.uploadSession;

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    if (file.status !== 'UPLOADING') {
      if (file.status === 'PROCESSING' || file.status === 'READY') {
        return this.mapFileResponse(file);
      }
      throw new BadRequestException('File is not in uploading state');
    }

    if (session.expiresAt < new Date()) {
      throw new BadRequestException('Upload session has expired');
    }

    if (session.uploadMode === 'MULTIPART') {
      if (!parts || parts.length === 0) {
        throw new BadRequestException('Multipart completion requires at least one part');
      }
      if (!session.s3UploadId) {
        throw new BadRequestException('Missing S3 upload ID');
      }

      const remoteEtags = await this.s3.listPartEtags(file.objectKey, session.s3UploadId);
      const resolvedParts = this.resolveEtags(parts, remoteEtags);

      await this.s3.completeMultipartUpload(
        file.objectKey,
        session.s3UploadId,
        resolvedParts,
      );
    }

    // Ensure the original file is publicly readable (belt-and-suspenders for
    // both single presigned uploads and multipart uploads on DO Spaces)
    await this.s3.setObjectAcl(file.objectKey, 'public-read');

    // Mark file as PROCESSING, update session
    const updated = await this.prisma.file.update({
      where: { id: fileId },
      data: {
        status: 'PROCESSING',
        uploadSession: {
          update: {
            bytesUploaded: file.sizeBytes,
            completedAt: new Date(),
          },
        },
      },
      include: { uploadSession: true, conversions: true },
    });

    return this.mapFileResponse(updated);
  }

  async abort(fileId: string, accountId: string) {
    const file = await this.getOwnedFile(fileId, accountId);
    const session = file.uploadSession;

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    if (file.status !== 'UPLOADING') {
      return;
    }

    if (session.uploadMode === 'MULTIPART' && session.s3UploadId) {
      await this.s3.abortMultipartUpload(file.objectKey, session.s3UploadId);
    }

    await this.prisma.file.update({
      where: { id: fileId },
      data: { status: 'FAILED', errorMessage: 'Aborted by client' },
    });
  }

  async getFile(fileId: string, accountId: string) {
    const file = await this.getOwnedFile(fileId, accountId);
    return this.mapFileResponse(file);
  }

  private async getOwnedFile(fileId: string, accountId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, accountId },
      include: { uploadSession: true, conversions: true },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return file;
  }

  private buildObjectKey(prefix: string, fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const token = randomBytes(8).toString('hex');
    const normalizedPrefix = prefix ? prefix.replace(/\/+$/, '') + '/' : '';
    return `${normalizedPrefix}${token}${ext}`;
  }

  private resolveChunkSize(sizeBytes: number): number {
    sizeBytes = Math.max(1, sizeBytes);
    const targetByCount = Math.ceil(sizeBytes / TARGET_PART_COUNT);
    const requiredByLimit = Math.ceil(sizeBytes / MAX_PART_COUNT);
    let chunk = Math.max(MIN_CHUNK_SIZE, targetByCount, requiredByLimit);
    chunk = Math.min(MAX_CHUNK_SIZE, chunk);
    return chunk;
  }

  private resolveEtags(
    parts: Array<{ part_number: number; etag?: string }>,
    remoteEtags: Record<number, string>,
  ): Array<{ ETag: string; PartNumber: number }> {
    const resolved: Array<{ ETag: string; PartNumber: number }> = [];

    for (const part of parts) {
      if (part.part_number < 1) continue;
      const etag = (part.etag?.trim() || '') || remoteEtags[part.part_number] || '';
      if (!etag) {
        throw new BadRequestException(`Missing ETag for part ${part.part_number}`);
      }
      resolved.push({ ETag: etag, PartNumber: part.part_number });
    }

    resolved.sort((a, b) => a.PartNumber - b.PartNumber);
    return resolved;
  }

  mapFileResponse(file: any) {
    const conversions: Record<string, any> = {};
    if (file.conversions) {
      for (const c of file.conversions) {
        conversions[c.preset] = {
          url: this.s3.getPublicUrl(c.objectKey),
          width: c.width,
          height: c.height,
          status: c.status.toLowerCase(),
        };
      }
    }

    return {
      file_id: file.id,
      external_ref: file.externalRef,
      object_key: file.objectKey,
      original_name: file.originalName,
      mime_type: file.mimeType,
      size_bytes: Number(file.sizeBytes),
      status: file.status.toLowerCase(),
      url: this.s3.getPublicUrl(file.objectKey),
      conversions,
      error_message: file.errorMessage ?? null,
      created_at: file.createdAt?.toISOString(),
    };
  }
}
