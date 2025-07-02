import { UserResponse } from "./api";

export interface ICall {
  _id: string;
  type: CallType;
  callType: CallCategory;
  callerId: string;
  participants: CallParticipant[];
  chatId?: string;
  groupId?: string;
  status: CallStatus;
  startTime: Date;
  endTime?: Date;
  duration: number;
  quality: CallQuality;
  recording?: CallRecording;
  coturnServer: CoturnServerInfo;
  webrtcData: WebRTCData;
  endReason?: CallEndReason;
  createdAt: Date;
  updatedAt: Date;
}

export interface CallParticipant {
  userId: string;
  status: CallParticipantStatus;
  joinedAt?: Date;
  leftAt?: Date;
  duration?: number;
}

export interface CallQuality {
  video: QualityLevel;
  audio: QualityLevel;
}

export interface CallRecording {
  enabled: boolean;
  url?: string;
  duration?: number;
  size?: number;
}

export interface CoturnServerInfo {
  region: string;
  server: string;
  username: string;
  credential: string;
}

export interface WebRTCData {
  offer?: string;
  answer?: string;
  iceCandidates: string[];
}

export type CallType = 'voice' | 'video';
export type CallCategory = 'individual' | 'group';
export type CallStatus = 'initiated' | 'ringing' | 'connected' | 'ended' | 'failed' | 'cancelled';
export type CallParticipantStatus = 'calling' | 'ringing' | 'connected' | 'declined' | 'missed' | 'busy' | 'ended';
export type CallEndReason = 'completed' | 'declined' | 'missed' | 'failed' | 'cancelled' | 'busy';
export type QualityLevel = 'low' | 'medium' | 'high';

export interface CallInitiateRequest {
  type: CallType;
  callType: CallCategory;
  participants: string[];
  chatId?: string;
  groupId?: string;
}

export interface CallJoinRequest {
  callId: string;
  webrtcData?: Partial<WebRTCData>;
}

export interface CallEndRequest {
  callId: string;
  endReason: CallEndReason;
}

export interface CallResponse {
  call: ICall;
  participantDetails?: UserResponse[];
}

export interface CallListResponse {
  calls: CallResponse[];
  total: number;
  page: number;
  limit: number;
}