import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service.js';
import { S3Service } from '../storage/s3.service.js';

@Controller('files')
@UseGuards(AuthGuard('jwt'))
export class FilesController {
  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
  ) {}

  @Get(':fileId')
  async getFile(@Param('fileId') fileId: string, @Request() req) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, accountId: req.user.accountId },
      include: { conversions: true },
    });

    if (!file) throw new NotFoundException('File not found');

    return { data: this.mapFile(file) };
  }

  @Get()
  async listFiles(
    @Query('external_ref') externalRef: string,
    @Request() req,
  ) {
    const where: any = { accountId: req.user.accountId };
    if (externalRef) {
      where.externalRef = externalRef;
    }

    const files = await this.prisma.file.findMany({
      where,
      include: { conversions: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return { data: files.map((f) => this.mapFile(f)) };
  }

  private mapFile(file: any) {
    const conversions: Record<string, any> = {};
    for (const c of file.conversions ?? []) {
      conversions[c.preset] = {
        url: this.s3.getPublicUrl(c.objectKey),
        width: c.width,
        height: c.height,
        status: c.status.toLowerCase(),
      };
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
