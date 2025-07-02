import { ChatResponse, GroupSettings, UserResponse } from "./api";

export interface IGroup {
  _id: string;
  chatId: string;
  name: string;
  description: string;
  avatar: string;
  creator: string;
  admins: string[];
  members: GroupMember[];
  inviteLink: string;
  inviteCode: string;
  settings: GroupSettings;
  memberCount: number;
  maxMembers: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMember {
  userId: string;
  role: GroupRole;
  joinedAt: Date;
  addedBy: string;
}

export type GroupRole = 'member' | 'admin';

export interface GroupCreateRequest {
  name: string;
  description?: string;
  avatar?: string;
  members: string[];
  settings?: Partial<GroupSettings>;
}

export interface GroupUpdateRequest {
  name?: string;
  description?: string;
  avatar?: string;
  settings?: Partial<GroupSettings>;
}

export interface GroupMemberRequest {
  members: string[];
}

export interface GroupResponse {
  group: IGroup;
  chat?: ChatResponse;
  memberDetails?: UserResponse[];
}

export interface GroupListResponse {
  groups: GroupResponse[];
  total: number;
  page: number;
  limit: number;
}
