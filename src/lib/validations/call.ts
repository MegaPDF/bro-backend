import { z } from 'zod';
import { CALL_TYPES, CALL_STATUS, DEFAULTS } from '@/lib/utils/constants';

// WebRTC connection data schema
export const webrtcDataSchema = z.object({
  offer: z.string()
    .min(1, 'WebRTC offer required')
    .optional(),
  answer: z.string()
    .min(1, 'WebRTC answer required')
    .optional(),
  iceCandidates: z.array(z.string().min(1, 'ICE candidate required'))
    .max(20, 'Too many ICE candidates')
    .optional(),
  sdpType: z.enum(['offer', 'answer', 'pranswer', 'rollback']).optional(),
  sessionId: z.string()
    .min(1, 'Session ID required')
    .optional()
});

// Call participant schema
export const callParticipantSchema = z.object({
  userId: z.string()
    .min(1, 'User ID required'),
  joinedAt: z.date()
    .default(() => new Date()),
  leftAt: z.date().optional(),
  status: z.enum(['joining', 'connected', 'disconnected', 'reconnecting'], {
    errorMap: () => ({ message: 'Invalid participant status' })
  }).default('joining'),
  audioEnabled: z.boolean().default(true),
  videoEnabled: z.boolean().default(true),
  screenSharing: z.boolean().default(false)
});

// Call quality metrics schema
export const callQualityMetricsSchema = z.object({
  audioQuality: z.number()
    .min(0, 'Audio quality must be non-negative')
    .max(5, 'Audio quality cannot exceed 5')
    .optional(),
  videoQuality: z.number()
    .min(0, 'Video quality must be non-negative')
    .max(5, 'Video quality cannot exceed 5')
    .optional(),
  connectionQuality: z.number()
    .min(0, 'Connection quality must be non-negative')
    .max(5, 'Connection quality cannot exceed 5')
    .optional(),
  latency: z.number()
    .min(0, 'Latency must be non-negative')
    .optional(),
  packetsLost: z.number()
    .min(0, 'Packets lost must be non-negative')
    .optional(),
  bandwidth: z.number()
    .min(0, 'Bandwidth must be non-negative')
    .optional()
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
    .max(DEFAULTS.CALL_MAX_PARTICIPANTS, `Maximum ${DEFAULTS.CALL_MAX_PARTICIPANTS} participants allowed`),
  chatId: z.string()
    .min(1, 'Chat ID required')
    .optional(),
  groupId: z.string()
    .min(1, 'Group ID required')
    .optional(),
  audioEnabled: z.boolean().default(true),
  videoEnabled: z.boolean().default(true)
}).refine((data) => {
  // Individual calls should have exactly 2 participants
  if (data.callType === 'individual' && data.participants.length !== 1) {
    return false; // 1 because the caller is not included in participants array
  }
  // Group calls require groupId
  if (data.callType === 'group' && !data.groupId) {
    return false;
  }
  // Video calls should have video enabled by default
  if (data.type === CALL_TYPES.VIDEO && data.videoEnabled === false) {
    return false;
  }
  return true;
}, {
  message: 'Invalid call configuration',
  path: ['callType']
});

// Call join schema
export const callJoinSchema = z.object({
  callId: z.string()
    .min(1, 'Call ID required'),
  webrtcData: webrtcDataSchema.optional(),
  audioEnabled: z.boolean().default(true),
  videoEnabled: z.boolean().default(true)
});

// Call update schema
export const callUpdateSchema = z.object({
  audioEnabled: z.boolean().optional(),
  videoEnabled: z.boolean().optional(),
  screenSharing: z.boolean().optional(),
  status: z.enum([
    CALL_STATUS.RINGING,
    CALL_STATUS.CONNECTING,
    CALL_STATUS.CONNECTED,
    CALL_STATUS.ENDED,
    CALL_STATUS.FAILED,
    CALL_STATUS.DECLINED,
    CALL_STATUS.MISSED,
    CALL_STATUS.BUSY
  ] as const).optional(),
  qualityMetrics: callQualityMetricsSchema.optional()
});

// Call end schema
export const callEndSchema = z.object({
  callId: z.string()
    .min(1, 'Call ID required'),
  endReason: z.enum([
    'completed',
    'declined',
    'missed',
    'failed',
    'cancelled',
    'busy',
    'network_error',
    'timeout'
  ], {
    errorMap: () => ({ message: 'Invalid call end reason' })
  }),
  duration: z.number()
    .min(0, 'Duration must be non-negative')
    .optional(),
  qualityRating: z.number()
    .min(1, 'Quality rating must be between 1 and 5')
    .max(5, 'Quality rating must be between 1 and 5')
    .optional()
});

// Call search schema
export const callSearchSchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit cannot exceed 100').default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().max(100, 'Search query too long').optional(),
  filters: z.record(z.any()).optional(),
  type: z.enum([CALL_TYPES.VOICE, CALL_TYPES.VIDEO] as const).optional(),
  status: z.enum([
    CALL_STATUS.RINGING,
    CALL_STATUS.CONNECTING,
    CALL_STATUS.CONNECTED,
    CALL_STATUS.ENDED,
    CALL_STATUS.FAILED,
    CALL_STATUS.DECLINED,
    CALL_STATUS.MISSED,
    CALL_STATUS.BUSY
  ] as const).optional(),
  callType: z.enum(['individual', 'group']).optional(),
  participantId: z.string().min(1, 'Participant ID required').optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  minDuration: z.number().min(0, 'Minimum duration must be non-negative').optional(),
  maxDuration: z.number().min(0, 'Maximum duration must be non-negative').optional()
});

// WebRTC signaling schema
export const webrtcSignalingSchema = z.object({
  callId: z.string()
    .min(1, 'Call ID required'),
  type: z.enum(['offer', 'answer', 'ice-candidate', 'bye'], {
    errorMap: () => ({ message: 'Invalid WebRTC signaling type' })
  }),
  data: z.object({
    sdp: z.string().optional(),
    candidate: z.string().optional(),
    sdpMLineIndex: z.number().optional(),
    sdpMid: z.string().optional()
  }).optional(),
  targetUserId: z.string()
    .min(1, 'Target user ID required')
    .optional()
});

// Call recording schema
export const callRecordingSchema = z.object({
  callId: z.string()
    .min(1, 'Call ID required'),
  action: z.enum(['start', 'stop', 'pause', 'resume'], {
    errorMap: () => ({ message: 'Invalid recording action' })
  }),
  consent: z.boolean().default(false), // Required for recording
  quality: z.enum(['low', 'medium', 'high']).default('medium')
}).refine((data) => {
  // Recording requires consent
  if (['start', 'resume'].includes(data.action) && !data.consent) {
    return false;
  }
  return true;
}, {
  message: 'Recording requires user consent',
  path: ['consent']
});