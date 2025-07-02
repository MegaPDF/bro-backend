import { z } from 'zod';
import { CALL_TYPES, CALL_STATUS, CALL_END_REASONS, DEFAULTS } from '@/lib/utils/constants';

// WebRTC data schema
export const webrtcDataSchema = z.object({
  offer: z.string()
    .min(1, 'WebRTC offer required')
    .optional(),
  answer: z.string()
    .min(1, 'WebRTC answer required')
    .optional(),
  iceCandidates: z.array(z.string().min(1, 'ICE candidate required'))
    .max(50, 'Too many ICE candidates')
    .default([])
});

// Call quality schema
export const callQualitySchema = z.object({
  video: z.enum(['low', 'medium', 'high'], {
    errorMap: () => ({ message: 'Video quality must be low, medium, or high' })
  }).default('medium'),
  audio: z.enum(['low', 'medium', 'high'], {
    errorMap: () => ({ message: 'Audio quality must be low, medium, or high' })
  }).default('high')
});

// Call participant schema
export const callParticipantSchema = z.object({
  userId: z.string()
    .min(1, 'User ID required'),
  status: z.enum(['calling', 'ringing', 'connected', 'declined', 'missed', 'busy', 'ended'], {
    errorMap: () => ({ message: 'Invalid participant status' })
  }).default('calling'),
  joinedAt: z.date().optional(),
  leftAt: z.date().optional(),
  duration: z.number()
    .min(0, 'Duration must be non-negative')
    .default(0)
});

// Call initiate schema
export const callInitiateSchema = z.object({
  type: z.enum([CALL_TYPES.VOICE, CALL_TYPES.VIDEO] as const, {
    errorMap: () => ({ message: 'Call type must be voice or video' })
  }),
  callType: z.enum(['individual', 'group'], {
    errorMap: () => ({ message: 'Call type must be individual or group' })
  }),
  participants: z.array(z.string().min(1, 'Participant ID required'))
    .min(1, 'At least one participant required')
    .max(8, 'Maximum 8 participants allowed for group calls'),
  chatId: z.string()
    .min(1, 'Chat ID required')
    .optional(),
  groupId: z.string()
    .min(1, 'Group ID required')
    .optional(),
  quality: callQualitySchema.optional()
}).refine((data) => {
  // Individual calls need exactly one participant (other than caller)
  if (data.callType === 'individual' && data.participants.length !== 1) {
    return false;
  }
  // Group calls need at least 2 participants (excluding caller)
  if (data.callType === 'group' && data.participants.length < 2) {
    return false;
  }
  return true;
}, {
  message: 'Invalid participant count for call type',
  path: ['participants']
});

// Call join schema
export const callJoinSchema = z.object({
  callId: z.string()
    .min(1, 'Call ID required'),
  webrtcData: webrtcDataSchema.optional()
});

// Call end schema
export const callEndSchema = z.object({
  callId: z.string()
    .min(1, 'Call ID required'),
  endReason: z.enum([
    CALL_END_REASONS.COMPLETED,
    CALL_END_REASONS.DECLINED,
    CALL_END_REASONS.MISSED,
    CALL_END_REASONS.FAILED,
    CALL_END_REASONS.CANCELLED,
    CALL_END_REASONS.BUSY
  ] as const, {
    errorMap: () => ({ message: 'Invalid end reason' })
  })
});

// Call action schema
export const callActionSchema = z.object({
  callId: z.string()
    .min(1, 'Call ID required'),
  action: z.enum(['accept', 'decline', 'mute', 'unmute', 'video_on', 'video_off', 'speaker_on', 'speaker_off'], {
    errorMap: () => ({ message: 'Invalid call action' })
  })
});

// Call search schema
export const callSearchSchema = z.object({
  callerId: z.string()
    .min(1, 'Caller ID required')
    .optional(),
  participantId: z.string()
    .min(1, 'Participant ID required')
    .optional(),
  type: z.enum([CALL_TYPES.VOICE, CALL_TYPES.VIDEO] as const).optional(),
  callType: z.enum(['individual', 'group']).optional(),
  status: z.enum([
    CALL_STATUS.INITIATED,
    CALL_STATUS.RINGING,
    CALL_STATUS.CONNECTED,
    CALL_STATUS.ENDED,
    CALL_STATUS.FAILED,
    CALL_STATUS.CANCELLED
  ] as const).optional(),
  endReason: z.enum([
    CALL_END_REASONS.COMPLETED,
    CALL_END_REASONS.DECLINED,
    CALL_END_REASONS.MISSED,
    CALL_END_REASONS.FAILED,
    CALL_END_REASONS.CANCELLED,
    CALL_END_REASONS.BUSY
  ] as const).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  minDuration: z.number()
    .min(0, 'Minimum duration must be non-negative')
    .optional(),
  page: z.coerce.number()
    .int()
    .min(1, 'Page must be at least 1')
    .default(1),
  limit: z.coerce.number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(DEFAULTS.PAGINATION_LIMIT),
  sort: z.enum(['startTime', 'duration', 'endTime'])
    .default('startTime'),
  order: z.enum(['asc', 'desc'])
    .default('desc')
});

// Call recording schema
export const callRecordingSchema = z.object({
  callId: z.string()
    .min(1, 'Call ID required'),
  enabled: z.boolean(),
  consentGiven: z.boolean(), // Required for legal compliance
  participants: z.array(z.string().min(1, 'Participant ID required'))
    .min(1, 'At least one participant consent required')
}).refine((data) => {
  // Recording requires explicit consent
  return !data.enabled || data.consentGiven;
}, {
  message: 'Recording requires explicit consent from all participants',
  path: ['consentGiven']
});
