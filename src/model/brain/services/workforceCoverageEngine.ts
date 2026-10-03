import { BrainSupplyRepository } from '../repositories/brainSupplyRepository.js';
import { ModelCertificationRepository } from '../../certification/modelCertificationRepository.js';
import { WorkforceCoverageReport, WorkforceCoverageAgentGap } from '../types/brainSupplyTypes.js';
import { CapabilityTier } from '../../certification/certificationTypes.js';

export class WorkforceCoverageEngine {
  private brainRepo: BrainSupplyRepository;
  private certRepo: ModelCertificationRepository;

  constructor(
    brainRepo: BrainSupplyRepository = new BrainSupplyRepository(),
    certRepo: ModelCertificationRepository = new ModelCertificationRepository()
  ) {
    this.brainRepo = brainRepo;
    this.certRepo = certRepo;
  }

  /**
   * Evaluates workforce brain coverage for all active agents in tenant (§18.6.1).
   */
  public async evaluateCoverage(tenantId: string): Promise<WorkforceCoverageReport> {
    const activeBrains = await this.brainRepo.listTenantBrains(tenantId);
    const certifiedBrains = activeBrains.filter((b) => b.status === 'certified' && b.healthStatus === 'healthy');

    // Canonical active agent fleet requirements for tenant
    const agentRequirements: Array<{
      agentSlug: string;
      agentName: string;
      requiredTier: CapabilityTier;
      requiredLanguages: string[];
    }> = [
      {
        agentSlug: 'lead_qualification_specialist',
        agentName: 'Lead Qualification Specialist',
        requiredTier: 'T1',
        requiredLanguages: ['en', 'hi'],
      },
      {
        agentSlug: 'customer_support_specialist',
        agentName: 'Customer Support Specialist',
        requiredTier: 'T2',
        requiredLanguages: ['en', 'hi'],
      },
      {
        agentSlug: 'booking_specialist',
        agentName: 'Booking Specialist',
        requiredTier: 'T2',
        requiredLanguages: ['en', 'hi'],
      },
      {
        agentSlug: 'retention_specialist',
        agentName: 'Customer Retention Specialist',
        requiredTier: 'T3',
        requiredLanguages: ['en'],
      },
      {
        agentSlug: 'workforce_orchestrator',
        agentName: 'Hierarchical Workforce Orchestrator',
        requiredTier: 'T3',
        requiredLanguages: ['en'],
      },
    ];

    const gaps: WorkforceCoverageAgentGap[] = [];
    let coveredCount = 0;

    for (const agent of agentRequirements) {
      // Find if there is any certified brain that supports requiredTier and all requiredLanguages
      const matchingBrain = certifiedBrains.find((brain) => {
        const hasTier = brain.certifiedTiers.includes(agent.requiredTier);
        const hasLangs = agent.requiredLanguages.every((lang) => brain.certifiedLanguages.includes(lang));
        return hasTier && hasLangs;
      });

      if (matchingBrain) {
        coveredCount++;
        gaps.push({
          agentSlug: agent.agentSlug,
          agentName: agent.agentName,
          requiredTier: agent.requiredTier,
          requiredLanguages: agent.requiredLanguages,
          status: 'covered',
          assignedModelId: matchingBrain.modelId,
        });
      } else {
        // Check if there is a degraded brain (e.g. tier match but missing a language)
        const partialBrain = certifiedBrains.find((brain) => brain.certifiedTiers.includes(agent.requiredTier));
        const status = partialBrain ? 'degraded' : 'uncovered';
        const reason = partialBrain
          ? `Missing language coverage for [${agent.requiredLanguages.join(', ')}]`
          : `No certified ${agent.requiredTier} brain available`;

        gaps.push({
          agentSlug: agent.agentSlug,
          agentName: agent.agentName,
          requiredTier: agent.requiredTier,
          requiredLanguages: agent.requiredLanguages,
          status,
          reason,
          assignedModelId: partialBrain?.modelId,
        });
      }
    }

    const totalAgentsCount = agentRequirements.length;
    const uncoveredCount = totalAgentsCount - coveredCount;
    const allCovered = uncoveredCount === 0;

    const statusHeadline = allCovered
      ? 'Every agent in your workforce has a certified brain.'
      : `${uncoveredCount} agent${uncoveredCount > 1 ? 's have' : ' has'} no certified brain → see Workforce`;

    return {
      allCovered,
      totalAgentsCount,
      coveredAgentsCount: coveredCount,
      uncoveredAgentsCount: uncoveredCount,
      statusHeadline,
      isHealthy: allCovered,
      gaps,
    };
  }
}
