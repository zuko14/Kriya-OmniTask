/**
 * Kriya Omnitask — Governed Adaptation Module (§6, §23 M12, WP-6.4)
 * Central export of types, repositories, services, and canary routing.
 */

export * from './types/adaptationTypes.js';
export * from './repositories/adaptationRepository.js';
export * from './services/failureClusteringService.js';
export * from './services/remediationProposalService.js';
export * from './services/adaptationSimulationEngine.js';
export * from './services/failureHarvestingService.js';
export * from './services/governedAdaptationService.js';
export * from './canary/adaptationCanaryRouter.js';
