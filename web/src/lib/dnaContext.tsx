/**
 * Kriya Omnitask — Business DNA Context & Hook (§3, §4, §18)
 * Exposes dynamic entity vocabulary, active capabilities, lifecycle stages, and agent roster.
 * "A feature not in the DNA profile is absent from the UI, not disabled."
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch } from './apiClient';

export interface EntityVocabulary {
  customer: string;
  customer_plural: string;
  item: string;
  item_plural: string;
  transaction: string;
  transaction_plural: string;
  appointment: string;
  agent_term: string;
  custom_labels: Record<string, string>;
}

export interface KpiDefinition {
  id: string;
  label: string;
  unit: string;
  format: 'currency' | 'percent' | 'number' | 'duration' | 'text';
}

export interface DnaAgentSpec {
  id: string;
  slug: string;
  name: string;
  role: string;
  description: string;
  min_model_tier: 'T1' | 'T2' | 'T3' | 'T4';
  ceiling_autonomy: 'L1' | 'L2' | 'L3' | 'L4';
  skills: string[];
  tools: string[];
  forbidden_actions: string[];
  escalation_defaults: string[];
  is_optional: boolean;
  is_active: boolean;
}

export interface TenantRosterManifest {
  id: string;
  tenant_id: string;
  version: number;
  dna_profile_id: string;
  dna_profile_version: string;
  entity_vocabulary: EntityVocabulary;
  capabilities: string[];
  lifecycle_stages: string[];
  agents: DnaAgentSpec[];
  checksum: string;
  status: 'active' | 'superseded' | 'rolled_back';
  created_by: string;
  created_at: string;
  rolled_back_from_version?: number | null;
}

export interface DnaProfile {
  id: string;
  version: string;
  business_type: string;
  display_name: string;
  description?: string;
  lifecycle_model: {
    stages: string[];
    initial_stage: string;
    terminal_stages: string[];
  };
  entity_vocabulary: EntityVocabulary;
  capabilities: string[];
  required_agents: DnaAgentSpec[];
  optional_agents: DnaAgentSpec[];
  forbidden_actions: string[];
  compliance_profile: Record<string, any>;
  default_kpis: KpiDefinition[];
  knowledge_schema: string[];
  escalation_defaults: string[];
  skill_grants: string[];
  external_retrieval_policy: { allowed: boolean; allowed_domains: string[] };
  min_tier_requirements: Record<string, string>;
  is_active: boolean;
}

export interface ResolvedTenantDna {
  tenantId: string;
  activeManifest: TenantRosterManifest;
  dnaProfile: DnaProfile;
  vocabulary: EntityVocabulary;
  capabilities: string[];
  lifecycleStages: string[];
  agents: DnaAgentSpec[];
  kpis: KpiDefinition[];
}

export interface DnaContextValue {
  dna: ResolvedTenantDna | null;
  vocabulary: EntityVocabulary;
  capabilities: string[];
  lifecycleStages: string[];
  agents: DnaAgentSpec[];
  kpis: KpiDefinition[];
  isLoading: boolean;
  hasCapability: (capability: string) => boolean;
  getLabel: (key: string, fallback: string) => string;
  refreshDna: () => Promise<void>;
}

const defaultVocabulary: EntityVocabulary = {
  customer: 'Customer',
  customer_plural: 'Customers',
  item: 'Item',
  item_plural: 'Items',
  transaction: 'Transaction',
  transaction_plural: 'Transactions',
  appointment: 'Appointment',
  agent_term: 'Agent',
  custom_labels: {},
};

export const DnaContext = createContext<DnaContextValue>({
  dna: null,
  vocabulary: defaultVocabulary,
  capabilities: [],
  lifecycleStages: [],
  agents: [],
  kpis: [],
  isLoading: false,
  hasCapability: () => true,
  getLabel: (_, fallback) => fallback,
  refreshDna: async () => {},
});

export const DnaProvider: React.FC<{ children: React.ReactNode; tenantId?: string }> = ({
  children,
  tenantId = 'default_tenant',
}) => {
  const [dna, setDna] = useState<ResolvedTenantDna | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchDna = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await apiFetch<ResolvedTenantDna>(`/api/v1/tenants/${tenantId}/dna`);
      setDna(res);
    } catch {
      // Fallback gracefully if endpoint is unavailable or mocked
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchDna();
  }, [fetchDna]);

  const vocabulary = dna?.vocabulary || defaultVocabulary;
  const capabilities = dna?.capabilities || [];
  const lifecycleStages = dna?.lifecycleStages || [];
  const agents = dna?.agents || [];
  const kpis = dna?.kpis || [];

  const hasCapability = useCallback(
    (capability: string): boolean => {
      if (!dna) return true; // If DNA not yet loaded, allow default view
      return capabilities.includes(capability);
    },
    [dna, capabilities]
  );

  const getLabel = useCallback(
    (key: string, fallback: string): string => {
      if (vocabulary.custom_labels && vocabulary.custom_labels[key]) {
        return vocabulary.custom_labels[key];
      }
      if (key in vocabulary) {
        return (vocabulary as any)[key] || fallback;
      }
      return fallback;
    },
    [vocabulary]
  );

  return (
    <DnaContext.Provider
      value={{
        dna,
        vocabulary,
        capabilities,
        lifecycleStages,
        agents,
        kpis,
        isLoading,
        hasCapability,
        getLabel,
        refreshDna: fetchDna,
      }}
    >
      {children}
    </DnaContext.Provider>
  );
};

export function useBusinessDna(): DnaContextValue {
  return useContext(DnaContext);
}
