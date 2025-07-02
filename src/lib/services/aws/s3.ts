import { S3 } from 'aws-sdk';
import path from 'path';
import sharp from 'sharp';
import { connectDB } from '@/lib/db/connection';
import Media from '@/lib/db/models/Media';
import { FILE_SIZE_LIMITS, SUPPORTED_FILE_TYPES, MIME_TYPES, MEDIA_TYPES, MEDIA_USAGE } from '@/lib/utils/constants';
import { FileUploadService } from '@/lib/utils/file-upload';
import { EncryptionService } from '@/lib/utils/encryption';
import type { IMedia } from '@/types/media';
import type { MediaType, MediaUsage } from '@/types/media';

export interface S3UploadOptions {
  generateThumbnail?: boolean;
  compress?: boolean;
  quality?: number;
  encrypt?: boolean;
  makePublic?: boolean;
  expiresIn?: number;
}

export interface S3UploadResult {
  success: boolean;
  media?: IMedia;
  url?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface S3FileInfo {
  key: string;
  size: number;
  lastModified: Date;
  etag: string;
  metadata: Record<string, string>;
}

export class S3Service {
  private s3: S3;
  private bucketName: string;
  private region: string;
  private cloudFrontDomain?: string;

  constructor() {
    this.s3 = new S3({
      region: process.env.AWS_S3_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      signatureVersion: 'v4'
    });

    this.bucketName = process.env.AWS_S3_BUCKET!;
    this.region = process.env.AWS_S3_REGION || 'us-east-1';
    this.cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN;

    if (!this.bucketName) {
      throw new Error('AWS_S3_BUCKET environment variable is required');
    }
  }

  // Upload file to S3
  async uploadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    userId: string,
    usage: MediaUsage,
    options: S3UploadOptions = {}
  ): Promise<S3UploadResult> {
    try {
      await connectDB();

      // Validate file
      const validation = FileUploadService.validateFile(buffer, originalName);
      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error
        };
      }

      // Determine media type
      const mediaType = FileUploadService.getMediaType(originalName, mimeType);
      
      // Generate unique filename
      const key = FileUploadService.generateFilename(originalName, userId, usage);
      
      // Process file based on type
      let processedBuffer = buffer;
      let dimensions: { width: number; height: number } | undefined;
      let duration: number | undefined;

      if (mediaType === MEDIA_TYPES.IMAGE && options.compress) {
        const result = await this.processImage(buffer, options.quality || 80);
        processedBuffer = result.buffer;
        dimensions = result.dimensions;
      } else if (mediaType === MEDIA_TYPES.VIDEO) {
        // Get video metadata
        const metadata = await this.getVideoMetadata(buffer);
        dimensions = metadata.dimensions;
        duration = metadata.duration;
      } else if (([MEDIA_TYPES.AUDIO, MEDIA_TYPES.VOICE] as readonly MediaType[]).includes(mediaType)) {
        // Get audio duration
        duration = await this.getAudioDuration(buffer);
      }

      // Encrypt if requested
      let encryptionKey: string | undefined;
      if (options.encrypt) {
        const key = EncryptionService.generateKey();
        const { encrypted, iv, tag } = EncryptionService.encrypt(processedBuffer.toString('base64'), key);
        processedBuffer = Buffer.from(`${encrypted}:${iv}:${tag}`, 'utf8');
        encryptionKey = key.toString('hex');
      }

      // Calculate checksum
      const checksum = FileUploadService.calculateChecksum(processedBuffer);

      // Upload to S3
      const uploadParams: S3.PutObjectRequest = {
        Bucket: this.bucketName,
        Key: key,
        Body: processedBuffer,
        ContentType: mimeType,
        ContentLength: processedBuffer.length,
        Metadata: {
          originalName,
          userId,
          usage,
          mediaType,
          uploadedAt: new Date().toISOString(),
          checksum,
          ...(encryptionKey && { encrypted: 'true' })
        },
        ...(options.makePublic && { ACL: 'public-read' }),
        ...(options.encrypt && { ServerSideEncryption: 'AES256' })
      };

      const uploadResult = await this.s3.upload(uploadParams).promise();

      // Generate URLs
      const url = this.getFileUrl(key, options.makePublic);
      let thumbnailUrl: string | undefined;

      // Generate thumbnail for images and videos
      if (options.generateThumbnail && ([MEDIA_TYPES.IMAGE, MEDIA_TYPES.VIDEO] as readonly MediaType[]).includes(mediaType)) {
        try {
          const thumbnailResult = await this.generateThumbnail(buffer, key, mediaType);
          if (thumbnailResult.success) {
            thumbnailUrl = thumbnailResult.url;
          }
        } catch (error) {
          console.error('Thumbnail generation failed:', error);
          // Don't fail the entire upload for thumbnail errors
        }
      }

      // Save to database
      const media = new Media({
        uploadedBy: userId,
        type: mediaType,
        originalName,
        filename: path.basename(key),
        mimeType,
        size: processedBuffer.length,
        duration,
        dimensions,
        url,
        thumbnailUrl,
        s3Key: key,
        s3Bucket: this.bucketName,
        isEncrypted: !!options.encrypt,
        encryptionKey,
        checksum,
        isCompressed: !!options.compress,
        compressionQuality: options.quality,
        metadata: {
          originalSize: buffer.length,
          s3Etag: uploadResult.ETag,
          s3Location: uploadResult.Location
        },
        usage,
        downloadCount: 0
      });

      await media.save();

      return {
        success: true,
        media: media.toObject(),
        url,
        thumbnailUrl
      };

    } catch (error: any) {
      console.error('S3 upload error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Generate presigned URL for upload
  async generatePresignedUploadUrl(
    filename: string,
    mimeType: string,
    userId: string,
    usage: MediaUsage,
    expiresIn: number = 3600
  ): Promise<{ uploadUrl: string; key: string; fields: Record<string, string> }> {
    const key = FileUploadService.generateFilename(filename, userId, usage);

    const params = {
      Bucket: this.bucketName,
      Key: key,
      Expires: expiresIn,
      Conditions: [
        ['content-length-range', 0, FILE_SIZE_LIMITS.DOCUMENT],
        ['starts-with', '$Content-Type', mimeType.split('/')[0]]
      ],
      Fields: {
        'Content-Type': mimeType,
        'x-amz-meta-user-id': userId,
        'x-amz-meta-usage': usage,
        'x-amz-meta-original-name': filename,
        'x-amz-meta-uploaded-at': new Date().toISOString()
      }
    };

    const signedPost = this.s3.createPresignedPost(params);

    return {
      uploadUrl: signedPost.url,
      key,
      fields: signedPost.fields
    };
  }

  // Generate presigned URL for download
  async generatePresignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    return await this.s3.getSignedUrlPromise('getObject', {
      Bucket: this.bucketName,
      Key: key,
      Expires: expiresIn
    });
  }

  // Download file from S3
  async downloadFile(key: string): Promise<{ buffer: Buffer; metadata: any }> {
    try {
      const result = await this.s3.getObject({
        Bucket: this.bucketName,
        Key: key
      }).promise();

      return {
        buffer: result.Body as Buffer,
        metadata: result.Metadata
      };

    } catch (error: any) {
      console.error('S3 download error:', error);
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  // Delete file from S3
  async deleteFile(key: string): Promise<boolean> {
    try {
      await this.s3.deleteObject({
        Bucket: this.bucketName,
        Key: key
      }).promise();

      // Update database
      await Media.findOneAndUpdate(
        { s3Key: key },
        { 
          isDeleted: true,
          deletedAt: new Date()
        }
      );

      return true;

    } catch (error: any) {
      console.error('S3 delete error:', error);
      return false;
    }
  }

  // Get file info
  async getFileInfo(key: string): Promise<S3FileInfo | null> {
    try {
      const result = await this.s3.headObject({
        Bucket: this.bucketName,
        Key: key
      }).promise();

      return {
        key,
        size: result.ContentLength || 0,
        lastModified: result.LastModified || new Date(),
        etag: result.ETag || '',
        metadata: result.Metadata || {}
      };

    } catch (error) {
      console.error('Get file info error:', error);
      return null;
    }
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

  // Copy file
  async copyFile(sourceKey: string, destinationKey: string): Promise<boolean> {
    try {
      await this.s3.copyObject({
        Bucket: this.bucketName,
        CopySource: `${this.bucketName}/${sourceKey}`,
        Key: destinationKey
      }).promise();

      return true;

    } catch (error: any) {
      console.error('S3 copy error:', error);
      return false;
    }
  }

  // List files with pagination
  async listFiles(
    prefix?: string,
    maxKeys: number = 1000,
    continuationToken?: string
  ): Promise<{
    files: Array<{ key: string; size: number; lastModified: Date }>;
    isTruncated: boolean;
    nextContinuationToken?: string;
  }> {
    try {
      const params: S3.ListObjectsV2Request = {
        Bucket: this.bucketName,
        MaxKeys: maxKeys,
        ...(prefix && { Prefix: prefix }),
        ...(continuationToken && { ContinuationToken: continuationToken })
      };

      const result = await this.s3.listObjectsV2(params).promise();

      const files = (result.Contents || []).map(object => ({
        key: object.Key!,
        size: object.Size || 0,
        lastModified: object.LastModified || new Date()
      }));

      return {
        files,
        isTruncated: result.IsTruncated || false,
        nextContinuationToken: result.NextContinuationToken
      };

    } catch (error: any) {
      console.error('S3 list files error:', error);
      throw new Error(`Failed to list files: ${error.message}`);
    }
  }

  // Bulk delete files
  async bulkDeleteFiles(keys: string[]): Promise<{ deleted: string[]; errors: string[] }> {
    try {
      const chunks = this.chunkArray(keys, 1000); // S3 limit is 1000 objects per request
      const deleted: string[] = [];
      const errors: string[] = [];

      for (const chunk of chunks) {
        try {
          const deleteParams: S3.DeleteObjectsRequest = {
            Bucket: this.bucketName,
            Delete: {
              Objects: chunk.map(key => ({ Key: key })),
              Quiet: false
            }
          };

          const result = await this.s3.deleteObjects(deleteParams).promise();

          // Track successful deletions
          result.Deleted?.forEach(obj => {
            if (obj.Key) deleted.push(obj.Key);
          });

          // Track errors
          result.Errors?.forEach(error => {
            if (error.Key) errors.push(error.Key);
          });

        } catch (error) {
          console.error('Bulk delete chunk error:', error);
          errors.push(...chunk);
        }
      }

      // Update database for deleted files
      if (deleted.length > 0) {
        await Media.updateMany(
          { s3Key: { $in: deleted } },
          { 
            isDeleted: true,
            deletedAt: new Date()
          }
        );
      }

      return { deleted, errors };

    } catch (error: any) {
      console.error('Bulk delete error:', error);
      throw new Error(`Failed to bulk delete files: ${error.message}`);
    }
  }

  // Private helper methods
  private getFileUrl(key: string, isPublic: boolean = false): string {
    if (isPublic && this.cloudFrontDomain) {
      return `https://${this.cloudFrontDomain}/${key}`;
    }
    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
  }

  private async processImage(buffer: Buffer, quality: number): Promise<{
    buffer: Buffer;
    dimensions: { width: number; height: number };
  }> {
    const processed = await sharp(buffer)
      .jpeg({ quality })
      .resize(2048, 2048, { 
        fit: 'inside',
        withoutEnlargement: true
      })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: processed.data,
      dimensions: {
        width: processed.info.width,
        height: processed.info.height
      }
    };
  }

  private async generateThumbnail(
    buffer: Buffer,
    originalKey: string,
    mediaType: MediaType
  ): Promise<{ success: boolean; url?: string; key?: string }> {
    try {
      let thumbnailBuffer: Buffer;

      if (mediaType === MEDIA_TYPES.IMAGE) {
        thumbnailBuffer = await sharp(buffer)
          .resize(300, 300, { fit: 'cover' })
          .jpeg({ quality: 70 })
          .toBuffer();
      } else if (mediaType === MEDIA_TYPES.VIDEO) {
        // For video thumbnails, you'd need to extract a frame
        // This is a placeholder - implement with ffmpeg
        throw new Error('Video thumbnail generation not implemented');
      } else {
        throw new Error('Unsupported media type for thumbnail');
      }

      const thumbnailKey = originalKey.replace(/(\.[^.]+)$/, '_thumb$1');

      await this.s3.upload({
        Bucket: this.bucketName,
        Key: thumbnailKey,
        Body: thumbnailBuffer,
        ContentType: 'image/jpeg',
        Metadata: {
          type: 'thumbnail',
          originalKey
        }
      }).promise();

      return {
        success: true,
        url: this.getFileUrl(thumbnailKey),
        key: thumbnailKey
      };

    } catch (error) {
      console.error('Thumbnail generation error:', error);
      return { success: false };
    }
  }

  private async getVideoMetadata(buffer: Buffer): Promise<{
    dimensions?: { width: number; height: number };
    duration?: number;
  }> {
    // Placeholder for video metadata extraction
    // Implement with ffmpeg or similar
    return {};
  }

  private async getAudioDuration(buffer: Buffer): Promise<number | undefined> {
    // Placeholder for audio duration extraction
    // Implement with ffmpeg or similar
    return undefined;
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
