import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InitiateUploadDto {
  @IsString() @IsNotEmpty()
  file_name: string;

  @IsString() @IsNotEmpty()
  mime_type: string;

  @IsInt() @Min(1) @Max(524288000) // 500 MB
  size_bytes: number;

  @IsOptional() @IsString()
  key_prefix?: string;

  @IsOptional() @IsString()
  external_ref?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional() @IsArray() @IsString({ each: true })
  presets?: string[];

  @IsOptional() @IsString()
  callback_url?: string;
}

export class InitiateUploadBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InitiateUploadItemDto)
  uploads: InitiateUploadItemDto[];
}

export class InitiateUploadItemDto {
  @IsString() @IsNotEmpty()
  client_id: string;

  @IsString() @IsNotEmpty()
  file_name: string;

  @IsString() @IsNotEmpty()
  mime_type: string;

  @IsInt() @Min(1) @Max(524288000)
  size_bytes: number;

  @IsOptional() @IsString()
  key_prefix?: string;

  @IsOptional() @IsString()
  external_ref?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional() @IsArray() @IsString({ each: true })
  presets?: string[];

  @IsOptional() @IsString()
  callback_url?: string;
}

export class CompleteUploadDto {
  @IsOptional() @IsArray()
  parts?: Array<{ part_number: number; etag?: string }>;
}

export class CompleteUploadBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteUploadBatchItemDto)
  uploads: CompleteUploadBatchItemDto[];
}

export class CompleteUploadBatchItemDto {
  @IsString() @IsNotEmpty()
  file_id: string;

  @IsOptional() @IsArray()
  parts?: Array<{ part_number: number; etag?: string }>;
}

export class GetPartUrlsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartUrlRequestDto)
  parts: PartUrlRequestDto[];
}

export class PartUrlRequestDto {
  @IsInt() @Min(1)
  part_number: number;

  @IsInt() @Min(1)
  content_length: number;
}
