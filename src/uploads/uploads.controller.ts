import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UploadsService } from './uploads.service.js';
import { ProcessingService } from '../processing/processing.service.js';
import {
  InitiateUploadDto,
  InitiateUploadBatchDto,
  CompleteUploadDto,
  CompleteUploadBatchDto,
  GetPartUrlsDto,
} from './dto/initiate-upload.dto.js';

@Controller('uploads')
@UseGuards(AuthGuard('jwt'))
export class UploadsController {
  constructor(
    private uploads: UploadsService,
    private processing: ProcessingService,
  ) {}

  @Post('initiate')
  @HttpCode(HttpStatus.CREATED)
  async initiate(@Body() dto: InitiateUploadDto, @Request() req) {
    const { accountId } = req.user;
    const result = await this.uploads.initiate({
      accountId,
      createdBy: req.user.userId,
      fileName: dto.file_name,
      mimeType: dto.mime_type,
      sizeBytes: dto.size_bytes,
      keyPrefix: dto.key_prefix,
      externalRef: dto.external_ref,
      metadata: dto.metadata,
      presets: dto.presets,
      callbackUrl: dto.callback_url,
    });

    return { data: result };
  }

  @Post('initiate-batch')
  @HttpCode(HttpStatus.CREATED)
  async initiateBatch(@Body() dto: InitiateUploadBatchDto, @Request() req) {
    const { accountId } = req.user;
    const items: Array<{ client_id: string; session: any }> = [];

    for (const upload of dto.uploads) {
      const session = await this.uploads.initiate({
        accountId,
        createdBy: req.user.userId,
        fileName: upload.file_name,
        mimeType: upload.mime_type,
        sizeBytes: upload.size_bytes,
        keyPrefix: upload.key_prefix,
        externalRef: upload.external_ref,
        metadata: upload.metadata,
        presets: upload.presets,
        callbackUrl: upload.callback_url,
      });

      items.push({
        client_id: upload.client_id,
        session,
      });
    }

    return { data: { items } };
  }

  @Post(':fileId/part-urls')
  async partUrls(
    @Param('fileId') fileId: string,
    @Body() dto: GetPartUrlsDto,
    @Request() req,
  ) {
    const { accountId } = req.user;
    const result = await this.uploads.getPartUrls(fileId, accountId, dto.parts);
    return { data: result };
  }

  @Post(':fileId/complete')
  async complete(
    @Param('fileId') fileId: string,
    @Body() dto: CompleteUploadDto,
    @Request() req,
  ) {
    const { accountId } = req.user;
    const result = await this.uploads.complete(fileId, accountId, dto.parts);

    // Trigger processing asynchronously (don't await — respond to client immediately)
    if (result.status === 'processing') {
      this.processing.startProcessing(result.file_id).catch(() => {});
    }

    return { data: result };
  }

  @Post('complete-batch')
  async completeBatch(@Body() dto: CompleteUploadBatchDto, @Request() req) {
    const { accountId } = req.user;
    const items: Array<{ file_id: string; success: boolean; file: any; error: string | null }> = [];

    for (const upload of dto.uploads) {
      try {
        const result = await this.uploads.complete(
          upload.file_id,
          accountId,
          upload.parts,
        );
        items.push({
          file_id: upload.file_id,
          success: true,
          file: result,
          error: null,
        });
      } catch (err: any) {
        items.push({
          file_id: upload.file_id,
          success: false,
          file: null,
          error: err.message || 'Completion failed',
        });
      }
    }

    return { data: { items } };
  }

  @Post(':fileId/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  async abort(@Param('fileId') fileId: string, @Request() req) {
    const { accountId } = req.user;
    await this.uploads.abort(fileId, accountId);
  }
}
