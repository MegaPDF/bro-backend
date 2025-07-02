
export interface IMedia {
  _id: string;
  uploadedBy: string;
  type: MediaType;
  originalName: string;
  filename: string;
  mimeType: string;
  size: number;
  duration?: number;
  dimensions?: MediaDimensions;
  url: string;
  thumbnailUrl?: string;
  s3Key: string;
  s3Bucket: string;
  isEncrypted: boolean;
  encryptionKey?: string;
  checksum: string;
  isCompressed: boolean;
  compressionQuality?: number;
  metadata: Record<string, any>;
  usage: MediaUsage;
  isDeleted: boolean;
  deletedAt?: Date;
  expiresAt?: Date;
  downloadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MediaDimensions {
  width: number;
  height: number;
}

export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'voice';
export type MediaUsage = 'message' | 'status' | 'profile' | 'group' | 'call_recording';

export interface MediaUploadRequest {
  file: File;
  type: MediaType;
  usage: MediaUsage;
  chatId?: string;
  compress?: boolean;
  quality?: number;
}

export interface MediaResponse {
  media: IMedia;
  uploadUrl?: string;
  downloadUrl?: string;
}

export interface MediaListResponse {
  media: MediaResponse[];
  total: number;
  page: number;
  limit: number;
}