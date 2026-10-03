/**
 * Kriya Omnitask — Four-Tier Memory Architecture Service (§8.2, §23)
 * Manages the separation across:
 * - Tier 0: Disposable in-window working context (rebuilt every turn)
 * - Tier 1: Authoritative structured session state (entities, decisions, commitments, open items in DB)
 * - Tier 2: Durable customer & business memory (Customer 360, DNA vocabulary, timeline in DB)
 * - Tier 3: Cold immutable archive (full transcripts, traces, audit ledger)
 *
 * Implements the DEFINITIVE TEST: Rebuilding working context from Tiers 1-2 when Tier 0 is wiped!
 */

import { SessionRepository } from '../repositories/sessionRepository.js';
import { CustomerRepository } from '../../customer360/repositories/customerRepository.js';
import { TimelineRepository } from '../../customer360/repositories/timelineRepository.js';
import { DnaRepository } from '../../governance/dna/dnaRepository.js';
import { ContextAssembler } from '../assembly/contextAssembler.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import {
  Tier1SessionState,
  RetrievedFact,
  LayeredContextAssembly,
  ConversationTurn,
} from '../types/contextTypes.js';

export class FourTierMemoryService {
  private sessionRepo: SessionRepository;
  private customerRepo: CustomerRepository;
  private timelineRepo: TimelineRepository;
  private dnaRepo: DnaRepository;

  constructor(
    sessionRepo?: SessionRepository,
    customerRepo?: CustomerRepository,
    timelineRepo?: TimelineRepository,
    dnaRepo?: DnaRepository
  ) {
    this.sessionRepo = sessionRepo || new SessionRepository();
    this.customerRepo = customerRepo || new CustomerRepository();
    this.timelineRepo = timelineRepo || new TimelineRepository();
    this.dnaRepo = dnaRepo || new DnaRepository();
  }

  /**
   * Retrieves Tier 1 Session State for a session.
   */
  public async getTier1SessionState(sessionId: string, tenantId: string): Promise<Tier1SessionState | null> {
    return this.sessionRepo.getSessionState(sessionId, tenantId);
  }

  /**
   * Saves or updates Tier 1 Session State.
   */
  public async saveTier1SessionState(state: Tier1SessionState): Promise<Tier1SessionState> {
    return this.sessionRepo.saveSessionState(state);
  }

  /**
   * Retrieves Tier 2 Customer & Business Memory (Customer 360 + DNA Vocabulary + Timeline).
   */
  public async getTier2Memory(params: {
    tenantId: string;
    customerId?: string | null;
    dnaProfileId?: string;
  }): Promise<{
    customerProfile?: any;
    recentTimelineEvents?: any[];
    dnaProfile?: any;
    vocabulary?: Record<string, string>;
  }> {
    const { tenantId, customerId, dnaProfileId } = params;

    let customerProfile = null;
    let recentTimelineEvents: any[] = [];
    if (customerId) {
      customerProfile = await TenantContextManager.withTenant(tenantId, 'default', () =>
        this.customerRepo.findById(customerId)
      );
      recentTimelineEvents = await TenantContextManager.withTenant(tenantId, 'default', () =>
        this.timelineRepo.getTimeline(customerId, { limit: 5 })
      );
    }

    const profileId = dnaProfileId || 'dna_retail_commerce';
    const dnaProfile = await this.dnaRepo.getProfile(profileId);
    const vocabulary = dnaProfile ? dnaProfile.entity_vocabulary : {};

    return {
      customerProfile,
      recentTimelineEvents,
      dnaProfile,
      vocabulary,
    };
  }

  /**
   * Retrieves Tier 3 Cold Archive (Full immutable transcripts and turns).
   */
  public async getTier3Archive(sessionId: string, tenantId: string): Promise<ConversationTurn[]> {
    return this.sessionRepo.listTurns(sessionId, tenantId);
  }

  /**
   * THE DEFINITIVE TEST (§8.2, §23):
   * Reconstructs a complete, valid Tier 0 Working Context purely from Tier 1 (session state)
   * and Tier 2 (customer & business memory) when Tier 0 working memory has been wiped to empty.
   */
  public async rebuildWorkingContextFromTiers1And2(params: {
    sessionId: string;
    tenantId: string;
    agentRolePrompt: string;
    taskObjective: string;
    maxBudgetTokens?: number;
  }): Promise<LayeredContextAssembly> {
    const { sessionId, tenantId, agentRolePrompt, taskObjective, maxBudgetTokens } = params;

    const session = await this.sessionRepo.findSessionById(sessionId, tenantId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found.`);
    }

    // 1. Fetch Tier 1: Structured Session State from Database
    const tier1State = await this.getTier1SessionState(sessionId, tenantId);

    // 2. Fetch Tier 2: Durable Customer Profile & DNA Profile from Database
    const tier2Memory = await this.getTier2Memory({
      tenantId,
      customerId: session.customer_id,
    });

    // 3. Assemble Layer 1: System Frame
    const systemFrame = agentRolePrompt;

    // 4. Assemble Layer 2: Tenant Frame (DNA Vocabulary & Identity)
    const vocab = tier2Memory.vocabulary || {};
    const tenantFrame = `Business Identity & DNA Profile: ${tier2Memory.dnaProfile?.display_name || 'Standard Enterprise'}\n` +
      `DNA Entity Vocabulary: ${JSON.stringify(vocab)}\n` +
      `Tenant Isolation Boundary: STRICT [${tenantId}]`;

    // 5. Assemble Layer 3: Task Frame
    const taskFrame = `Current Objective: ${taskObjective}\nSession Language: ${session.language}\nChannel: ${session.channel}`;

    // 6. Synthesize Layer 4: Retrieved Facts from Tiers 1 & 2
    const retrievedFacts: RetrievedFact[] = [];
    const now = new Date().toISOString();

    // Add Customer facts from Tier 2
    if (tier2Memory.customerProfile) {
      retrievedFacts.push({
        fact: `Customer Identity: ${tier2Memory.customerProfile.full_name} (${tier2Memory.customerProfile.primary_email || tier2Memory.customerProfile.primary_phone || 'Unverified'}). Lifecycle Stage: ${tier2Memory.customerProfile.lifecycle_stage}.`,
        source: 'Tier 2 (Customer 360)',
        trustTier: 'A',
        retrievedAt: now,
      });
    }

    // Add Structured Entities from Tier 1
    if (tier1State && Object.keys(tier1State.entities).length > 0) {
      for (const [key, value] of Object.entries(tier1State.entities)) {
        retrievedFacts.push({
          fact: `Session Entity [${key}]: ${typeof value === 'object' ? JSON.stringify(value) : value}`,
          source: 'Tier 1 (Session State Entities)',
          trustTier: 'A',
          retrievedAt: tier1State.extractedAt,
        });
      }
    }

    // Add Decisions from Tier 1
    if (tier1State && tier1State.decisions.length > 0) {
      for (const dec of tier1State.decisions) {
        retrievedFacts.push({
          fact: `Agreed Decision: ${dec.decision} (agreed by ${dec.agreedBy})`,
          source: 'Tier 1 (Session State Decisions)',
          trustTier: 'A',
          retrievedAt: dec.decidedAt,
        });
      }
    }

    // Add Commitments from Tier 1
    if (tier1State && tier1State.commitments.length > 0) {
      for (const com of tier1State.commitments) {
        retrievedFacts.push({
          fact: `Active Commitment: ${com.commitment} (Party: ${com.committedParty}, Status: ${com.status})`,
          source: 'Tier 1 (Session State Commitments)',
          trustTier: 'A',
          retrievedAt: com.createdAt,
        });
      }
    }

    // Add Open Items from Tier 1
    if (tier1State && tier1State.openItems.length > 0) {
      for (const item of tier1State.openItems) {
        retrievedFacts.push({
          fact: `Pending Open Item: ${item.questionOrNeed} (Assigned: ${item.assignedTo}, Priority: ${item.priority})`,
          source: 'Tier 1 (Session State Open Items)',
          trustTier: 'A',
          retrievedAt: item.createdAt,
        });
      }
    }

    // 7. Layer 6: Since Tier 0 was wiped, fetch only uncompacted recent turns if available
    const uncompactedTurns = await this.sessionRepo.listTurns(sessionId, tenantId, { uncompactedOnly: true });

    // 8. Assemble Layered Working Context using ContextAssembler
    return ContextAssembler.assemble({
      systemFrame,
      tenantFrame,
      taskFrame,
      retrievedFacts,
      recentTurns: uncompactedTurns,
      rollingSummary: session.rolling_summary,
      maxBudgetTokens: maxBudgetTokens || 8000,
    });
  }
}
