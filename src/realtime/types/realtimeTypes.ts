/**
 * Kriya Omnitask — Real-Time Data Layer Types & Envelopes (§19)
 */

import { z } from 'zod';

export const RealtimeEventTypeSchema = z.enum([
  'task.started',
  'task.completed',
  'task.failed',
  'task.escalated',
  'agent.state_changed',
  'attention.created',
  'approval.required',
  'model.degraded',
  'external.retrieved',
  'security.event',
  'stream.ping',
]);
export type RealtimeEventType = z.infer<typeof RealtimeEventTypeSchema>;

export const RealtimeEventEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  ts: z.string(),
  tenant_id: z.string().min(1),
  type: RealtimeEventTypeSchema,
  agent_id: z.string().optional(),
  execution_id: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
});
export type RealtimeEventEnvelope = z.infer<typeof RealtimeEventEnvelopeSchema>;

export interface RealtimeEventRecord {
  seq: number;
  tenant_id: string;
  ts: string;
  type: RealtimeEventType;
  agent_id: string | null;
  execution_id: string | null;
  payload_json: string;
  created_at: string;
}

export interface PublishRealtimeEventInput {
  tenantId: string;
  type: RealtimeEventType;
  agentId?: string;
  executionId?: string;
  payload?: Record<string, unknown>;
  ts?: string;
}

export interface StreamInitialSnapshot {
  tenantId: string;
  snapshotAt: string;
  latestSeq: number;
  events: RealtimeEventEnvelope[];
  agentStates: Record<string, { state: string; load: number; currentTask?: string; updatedAt: string }>;
}

export interface StreamBackfillResult {
  tenantId: string;
  fromSeq: number;
  toSeq: number;
  events: RealtimeEventEnvelope[];
  count: number;
  hasMore: boolean;
}
