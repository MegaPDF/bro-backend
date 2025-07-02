import { S3 } from 'aws-sdk';
import path from 'path';
import crypto from 'crypto';
import { FILE_SIZE_LIMITS, SUPPORTED_FILE_TYPES, MIME_TYPES, MEDIA_TYPES } from './constants';
import type { MediaType, MediaUsage } from '@/types/media';

export interface FileUploadOptions {
  maxSize?: number;
  allowedTypes?: string[];
  compress?: boolean;
  quality?: number;
  generateThumbnail?: boolean;
  encrypt?: boolean;
}

export interface UploadResult {
  success: boolean;
  url: string;
  key: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  thumbnailUrl?: string;
  duration?: number;
  dimensions?: { width: number; height: number };
  checksum: string;
  error?: string;
}

export class FileUploadService {
  private s3: S3;
  private bucketName: string;
  private region: string;

  constructor() {
    this.s3 = new S3({
      region: process.env.AWS_S3_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });
    this.bucketName = process.env.AWS_S3_BUCKET!;
    this.region = process.env.AWS_S3_REGION || 'us-east-1';
  }

  // Validate file before upload
  static validateFile(
    file: File | Buffer,
    filename: string,
    options: FileUploadOptions = {}
  ): { isValid: boolean; error?: string } {
    const fileSize = file instanceof File ? file.size : file.length;
    const mimeType = file instanceof File ? file.type : '';
    const extension = path.extname(filename).toLowerCase();

    // Check file size
    const maxSize = options.maxSize || FILE_SIZE_LIMITS.DOCUMENT;
    if (fileSize > maxSize) {
      return {
        isValid: false,
        error: `File size exceeds limit of ${this.formatFileSize(maxSize)}`
      };
    }

    // Check file extension
    const allowedTypes = options.allowedTypes || [
      ...SUPPORTED_FILE_TYPES.IMAGE,
      ...SUPPORTED_FILE_TYPES.VIDEO,
      ...SUPPORTED_FILE_TYPES.AUDIO,
      ...SUPPORTED_FILE_TYPES.DOCUMENT
    ];

    if (!allowedTypes.includes(extension)) {
      return {
        isValid: false,
        error: `File type ${extension} is not supported`
      };
    }

    // Check MIME type if available
    if (mimeType) {
      const allowedMimeTypes = [
        ...MIME_TYPES.IMAGE,
        ...MIME_TYPES.VIDEO,
        ...MIME_TYPES.AUDIO,
        ...MIME_TYPES.DOCUMENT
      ];

      if (!allowedMimeTypes.includes(mimeType as any)) {
        return {
          isValid: false,
          error: `MIME type ${mimeType} is not supported`
        };
      }
    }

    return { isValid: true };
  }

  // Determine media type from file
  static getMediaType(filename: string, mimeType?: string): MediaType {
    const extension = path.extname(filename).toLowerCase();

    if (
      SUPPORTED_FILE_TYPES.IMAGE.includes(extension as typeof SUPPORTED_FILE_TYPES.IMAGE[number]) ||
      (mimeType && MIME_TYPES.IMAGE.includes(mimeType as typeof MIME_TYPES.IMAGE[number]))
    ) {
      return MEDIA_TYPES.IMAGE;
    }

    if (
      SUPPORTED_FILE_TYPES.VIDEO.includes(extension as typeof SUPPORTED_FILE_TYPES.VIDEO[number]) ||
      (mimeType && MIME_TYPES.VIDEO.includes(mimeType as typeof MIME_TYPES.VIDEO[number]))
    ) {
      return MEDIA_TYPES.VIDEO;
    }

    if (
      SUPPORTED_FILE_TYPES.AUDIO.includes(extension as typeof SUPPORTED_FILE_TYPES.AUDIO[number]) ||
      (mimeType && MIME_TYPES.AUDIO.includes(mimeType as typeof MIME_TYPES.AUDIO[number]))
    ) {
      return MEDIA_TYPES.AUDIO;
    }

    return MEDIA_TYPES.DOCUMENT;
  }

  // Generate unique filename
  static generateFilename(originalName: string, userId: string, usage: MediaUsage): string {
    const extension = path.extname(originalName);
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const sanitizedName = path.basename(originalName, extension)
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .substring(0, 50);

    return `${usage}/${userId}/${timestamp}_${random}_${sanitizedName}${extension}`;
  }

  // Calculate file checksum
  static calculateChecksum(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  // Format file size for display
  static formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  // Upload file to S3
  async uploadFile(
    buffer: Buffer,
    filename: string,
    originalName: string,
    mimeType: string,
    userId: string,
    usage: MediaUsage,
    options: FileUploadOptions = {}
  ): Promise<UploadResult> {
    try {
      // Validate file
      const validation = FileUploadService.validateFile(buffer, filename, options);
      if (!validation.isValid) {
        return {
          success: false,
          url: '',
          key: '',
          filename: '',
          originalName: '',
          size: 0,
          mimeType: '',
          checksum: '',
          error: validation.error
        };
      }

      // Generate unique filename
      const key = FileUploadService.generateFilename(originalName, userId, usage);
      
      // Calculate checksum
      const checksum = FileUploadService.calculateChecksum(buffer);

      // Prepare upload parameters
      const uploadParams: S3.PutObjectRequest = {
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ContentLength: buffer.length,
        Metadata: {
          originalName,
          userId,
          usage,
          uploadedAt: new Date().toISOString(),
          checksum
        }
      };

      // Add encryption if specified
      if (options.encrypt) {
        uploadParams.ServerSideEncryption = 'AES256';
      }

      // Upload to S3
      const result = await this.s3.upload(uploadParams).promise();

      // Generate public URL
      const url = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;

      return {
        success: true,
        url,
        key,
        filename: path.basename(key),
        originalName,
        size: buffer.length,
        mimeType,
        checksum
      };

    } catch (error: any) {
      console.error('File upload error:', error);
      return {
        success: false,
        url: '',
        key: '',
        filename: '',
        originalName: '',
        size: 0,
        mimeType: '',
        checksum: '',
        error: error.message
      };
    }
  }

  // Generate presigned URL for direct upload
  async generatePresignedUrl(
    filename: string,
    mimeType: string,
    userId: string,
    usage: MediaUsage,
    expiresIn: number = 3600
  ): Promise<{ uploadUrl: string; key: string }> {
    const key = FileUploadService.generateFilename(filename, userId, usage);

    const uploadUrl = await this.s3.getSignedUrlPromise('putObject', {
      Bucket: this.bucketName,
      Key: key,
      ContentType: mimeType,
      Expires: expiresIn,
      Metadata: {
        userId,
        usage,
        originalName: filename
      }
    });

    return { uploadUrl, key };
  }

  // Delete file from S3
  async deleteFile(key: string): Promise<boolean> {
    try {
      await this.s3.deleteObject({
        Bucket: this.bucketName,
        Key: key
      }).promise();

      return true;
    } catch (error) {
      console.error('File deletion error:', error);
      return false;
    }
  }

  // Get file metadata
  async getFileMetadata(key: string): Promise<any> {
    try {
      const result = await this.s3.headObject({
        Bucket: this.bucketName,
        Key: key
      }).promise();

      return {
        size: result.ContentLength,
        lastModified: result.LastModified,
        contentType: result.ContentType,
        metadata: result.Metadata
      };
    } catch (error) {
      console.error('Get file metadata error:', error);
      return null;
    }
  }

  // Generate download URL with expiration
  async generateDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    return await this.s3.getSignedUrlPromise('getObject', {
      Bucket: this.bucketName,
      Key: key,
      Expires: expiresIn
    });
  }

  // Check if file exists
  async fileExists(key: string): Promise<boolean> {
    try {
      await this.s3.headObject({
        Bucket: this.bucketName,
        Key: key
      }).promise();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Copy file within S3
  async copyFile(sourceKey: string, destinationKey: string): Promise<boolean> {
    try {
      await this.s3.copyObject({
        Bucket: this.bucketName,
        CopySource: `${this.bucketName}/${sourceKey}`,
        Key: destinationKey
      }).promise();

      return true;
    } catch (error) {
      console.error('File copy error:', error);
      return false;
    }
  }
}
