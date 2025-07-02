import { IMedia, UserResponse } from "./api";

export interface IStatus {
  _id: string;
  userId: string;
  type: StatusType;
  content?: string;
  mediaId?: string;
  backgroundColor?: string;
  textColor?: string;
  font?: string;
  privacy: StatusPrivacy;
  viewers: StatusViewer[];
  expiresAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StatusPrivacy {
  type: StatusPrivacyType;
  excludedContacts?: string[];
  selectedContacts?: string[];
}

export interface StatusViewer {
  userId: string;
  viewedAt: Date;
}

export type StatusType = 'text' | 'image' | 'video';
export type StatusPrivacyType = 'everyone' | 'contacts' | 'contacts_except' | 'only_share_with';

export interface StatusCreateRequest {
  type: StatusType;
  content?: string;
  mediaId?: string;
  backgroundColor?: string;
  textColor?: string;
  font?: string;
  privacy?: StatusPrivacy;
}

export interface StatusResponse {
  status: IStatus;
  user?: UserResponse;
  mediaDetails?: IMedia;
  isViewed: boolean;
  viewCount: number;
}

export interface StatusListResponse {
  statuses: StatusResponse[];
  total: number;
  page: number;
  limit: number;
}
