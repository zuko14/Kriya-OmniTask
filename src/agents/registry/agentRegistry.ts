/**
 * Xylarc AI — Agent Registry Service
 * Manages tenant-scoped agent lifecycle specifications, template bootstrapping, and quota limits (§8, §12, §39 of CLAUDE.md).
 */

import { AgentRepository } from '../repositories/agentRepository.js';
import { AgentLifecycleManager } from '../lifecycle/agentLifecycleManager.js';
import { QuotaService } from '../../control-plane/quotas/quotaService.js';
import {
  AgentSpecification,
  AgentSpecificationInput,
  AgentSpecificationSchema,
  AgentRecord,
  AgentCategory,
  Department,
  AgentLifecycleState,
} from '../types/agentTypes.js';
import { SYSTEM_AGENT_TEMPLATES } from '../templates/defaultTemplates.js';
import { ValidationError, ConflictError, NotFoundError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';

export class AgentRegistryService {
  private agentRepo: AgentRepository;
  private lifecycleManager: AgentLifecycleManager;
  private quotaService: QuotaService;

  constructor(
    agentRepo?: AgentRepository,
    lifecycleManager?: AgentLifecycleManager,
    quotaService?: QuotaService
  ) {
    this.agentRepo = agentRepo || new AgentRepository();
    this.lifecycleManager = lifecycleManager || new AgentLifecycleManager(this.agentRepo);
    this.quotaService = quotaService || new QuotaService();
  }

  /**
   * Registers a new agent within the active tenant, enforcing quota limits and slug uniqueness.
   */
  public async registerAgent(spec: AgentSpecificationInput | AgentSpecification): Promise<AgentRecord> {
    const tenantId = TenantContextManager.getTenantId();
    const validatedSpec = AgentSpecificationSchema.parse(spec);

    // Check slug uniqueness within tenant
    const existing = await this.agentRepo.findBySlug(validatedSpec.slug);
    if (existing) {
      throw new ConflictError(
        `Agent with slug '${validatedSpec.slug}' already exists in tenant '${tenantId}'.`
      );
    }

    // Check tenant agent quota
    const currentAgents = await this.agentRepo.listAgents();
    await this.quotaService.assertAgentQuota(tenantId, currentAgents.length, 1);

    const record = await this.agentRepo.create({
      slug: validatedSpec.slug,
      name: validatedSpec.name,
      description: validatedSpec.description,
      category: validatedSpec.category,
      department: validatedSpec.department,
      autonomy_level: validatedSpec.autonomyLevel,
      risk_tier: validatedSpec.riskTier,
      status: 'draft',
      version: validatedSpec.version,
      is_system: validatedSpec.isSystem ? 1 : 0,
      config_json: JSON.stringify(validatedSpec.config),
    });

    logger.info(`Agent registered: ${record.name} (${record.slug}) in tenant ${tenantId}`, {
      agentId: record.id,
      slug: record.slug,
      category: record.category,
    });

    return record;
  }

  /**
   * Seeds default system templates for a new tenant workspace.
   */
  public async bootstrapSystemTemplates(): Promise<AgentRecord[]> {
    const created: AgentRecord[] = [];

    for (const template of SYSTEM_AGENT_TEMPLATES) {
      const existing = await this.agentRepo.findBySlug(template.slug);
      if (!existing) {
        const agent = await this.agentRepo.create({
          slug: template.slug,
          name: template.name,
          description: template.description,
          category: template.category,
          department: template.department,
          autonomy_level: template.autonomyLevel,
          risk_tier: template.riskTier,
          status: 'idle', // Pre-validated system templates start in idle state
          version: template.version,
          is_system: 1,
          config_json: JSON.stringify(template.config),
        });
        created.push(agent);
      }
    }

    return created;
  }

  /**
   * Retrieves an agent by ID with full parsed configuration.
   */
  public async getAgent(agentId: string): Promise<AgentRecord> {
    const agent = await this.agentRepo.findById(agentId);
    if (!agent) {
      throw new NotFoundError(`Agent with ID '${agentId}' not found.`);
    }
    return agent;
  }

  /**
   * Lists agents for the active tenant with optional filtering.
   */
  public async listAgents(filters?: {
    category?: AgentCategory;
    department?: Department;
    status?: AgentLifecycleState;
  }): Promise<AgentRecord[]> {
    return this.agentRepo.listAgents(filters);
  }

  /**
   * Updates an agent's specification (e.g. system prompt, tools, autonomy level).
   */
  public async updateAgent(
    agentId: string,
    updates: Partial<Omit<AgentSpecification, 'slug'>>
  ): Promise<AgentRecord> {
    const agent = await this.agentRepo.findById(agentId);
    if (!agent) {
      throw new NotFoundError(`Agent with ID '${agentId}' not found.`);
    }

    const currentConfig = JSON.parse(agent.config_json);
    const updatedConfig = updates.config ? { ...currentConfig, ...updates.config } : currentConfig;

    await this.agentRepo.update(agentId, {
      name: updates.name || agent.name,
      description: updates.description ?? agent.description,
      category: updates.category || agent.category,
      department: updates.department || agent.department,
      autonomy_level: updates.autonomyLevel !== undefined ? updates.autonomyLevel : agent.autonomy_level,
      risk_tier: updates.riskTier || agent.risk_tier,
      version: updates.version || agent.version,
      config_json: JSON.stringify(updatedConfig),
    });

    return (await this.agentRepo.findById(agentId))!;
  }

  /**
   * Deletes an agent from registry.
   */
  public async deleteAgent(agentId: string): Promise<void> {
    const agent = await this.agentRepo.findById(agentId);
    if (!agent) {
      throw new NotFoundError(`Agent with ID '${agentId}' not found.`);
    }
    await this.agentRepo.delete(agentId);
  }

  /**
   * Returns available built-in system templates.
   */
  public getSystemTemplates(): AgentSpecification[] {
    return SYSTEM_AGENT_TEMPLATES;
  }
}
