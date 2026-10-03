/**
 * Kriya AI — Autonomous Business Workforce Platform Bootloader
 * Initializes foundation services, executes pending database migrations,
 * and verifies system invariants.
 */

import { config } from './core/config/config.js';
import { assertRuntimeReadiness, getAppMode } from './core/config/runtimeMode.js';
import { logger } from './core/logger/logger.js';
import { db } from './storage/db.js';
import { SchemaMigrator } from './storage/migrations/migrator.js';
import { ensurePlatformOwner } from './security/auth/platformOperator.js';
import { buildServer } from './api/server.js';

export * from './core/config/config.js';
export * from './core/config/runtimeMode.js';
export * from './core/context/tenantContext.js';
export * from './core/errors/errors.js';
export * from './core/logger/logger.js';
export * from './core/utils/crypto.js';
export * from './storage/db.js';
export * from './storage/migrations/migrator.js';
export * from './storage/repositories/baseRepository.js';
export * from './storage/repositories/tenantRepository.js';
export * from './storage/repositories/orgRepository.js';
export * from './storage/repositories/userRepository.js';
export * from './security/rbac/rbac.js';
export * from './security/audit/auditLogger.js';
export * from './security/auth/jwt.js';
export * from './security/auth/apiKey.js';
export * from './control-plane/quotas/quotaService.js';
export * from './customer360/repositories/customerRepository.js';
export * from './customer360/repositories/identityRepository.js';
export * from './customer360/repositories/timelineRepository.js';
export * from './customer360/repositories/consentRepository.js';
export * from './customer360/services/entityResolutionService.js';
export * from './customer360/services/customer360Service.js';
export * from './channels/security/webhookVerifier.js';
export * from './channels/governor/frequencyGovernor.js';
export * from './channels/whatsapp/whatsappConnector.js';
export * from './channels/queue/outboundQueueService.js';
export * from './agents/types/agentTypes.js';
export * from './agents/repositories/agentRepository.js';
export * from './agents/lifecycle/agentLifecycleManager.js';
export * from './agents/registry/agentRegistry.js';
export * from './agents/templates/defaultTemplates.js';
export * from './orchestration/firewall/agentSafetyFirewall.js';
export * from './orchestration/routing/modelRouter.js';
export * from './orchestration/orchestrator/hierarchicalOrchestrator.js';
export * from './tools/types/toolTypes.js';
export * from './tools/repositories/toolRepository.js';
export * from './tools/vault/credentialVault.js';
export * from './tools/circuit/circuitBreaker.js';
export * from './tools/registry/toolRegistry.js';
export * from './tools/gateway/toolGateway.js';
export * from './policy/types/policyTypes.js';
export * from './policy/evaluator/conditionEvaluator.js';
export * from './policy/repositories/policyRepository.js';
export * from './policy/engine/policyEngine.js';
export * from './policy/verifier/deterministicVerifier.js';
export * from './workflows/types/workflowTypes.js';
export * from './workflows/interpolator/dataInterpolator.js';
export * from './workflows/repositories/workflowRepository.js';
export * from './workflows/engine/dagExecutor.js';
export * from './workflows/service/workflowService.js';
export * from './workforce/types/workforceTypes.js';
export * from './workforce/specialists/leadQualificationSpecialist.js';
export * from './workforce/specialists/calendarBookingSpecialist.js';
export * from './workforce/specialists/customerSupportSpecialist.js';
export * from './workforce/specialists/reactivationRetentionSpecialist.js';
export * from './workforce/service/lifecycleWorkforceService.js';
export * from './knowledge/types/knowledgeTypes.js';
export * from './knowledge/parsers/documentParser.js';
export * from './knowledge/parsers/documentChunker.js';
export * from './knowledge/embeddings/embeddingService.js';
export * from './knowledge/embeddings/bm25SearchEngine.js';
export * from './knowledge/safety/indirectInjectionShield.js';
export * from './knowledge/retrieval/hybridRetriever.js';
export * from './knowledge/repositories/knowledgeRepository.js';
export * from './knowledge/repositories/lineageRepository.js';
export * from './knowledge/service/knowledgeFabricService.js';
export * from './digitaltwin/types/digitalTwinTypes.js';
export * from './digitaltwin/graph/organizationGraph.js';
export * from './digitaltwin/kpi/kpiEngine.js';
export * from './digitaltwin/diagnostics/bottleneckDetector.js';
export * from './digitaltwin/repositories/digitalTwinRepository.js';
export * from './digitaltwin/repositories/kpiRepository.js';
export * from './digitaltwin/service/digitalTwinService.js';
export * from './bi/types/biTypes.js';
export * from './bi/aggregators/metricAggregator.js';
export * from './bi/synthesizer/briefingSynthesizer.js';
export * from './bi/repositories/briefingRepository.js';
export * from './bi/service/businessIntelligenceService.js';
export * from './observability/types/observabilityTypes.js';
export * from './observability/tracing/agentTracer.js';
export * from './observability/drift/driftDetector.js';
export * from './observability/repositories/traceRepository.js';
export * from './observability/service/observabilityService.js';
export * from './verification/types/verificationTypes.js';
export * from './verification/rules/preflightVerifier.js';
export * from './verification/reviewer/qualityReviewer.js';
export * from './verification/repositories/qualityReviewRepository.js';
export * from './verification/service/verificationService.js';
export * from './attention/types/attentionTypes.js';
export * from './attention/priority/priorityCalculator.js';
export * from './attention/repositories/attentionRepository.js';
export * from './attention/service/attentionService.js';
export * from './simulation/types/simulationTypes.js';
export * from './simulation/comparator/behavioralComparator.js';
export * from './simulation/sandbox/dryRunSandbox.js';
export * from './simulation/repositories/simulationRepository.js';
export * from './simulation/service/simulationService.js';
export * from './evaluation/types/evaluationTypes.js';
export * from './evaluation/gate/releaseGateEvaluator.js';
export * from './evaluation/benchmark/benchmarkRunner.js';
export * from './evaluation/repositories/evaluationRepository.js';
export * from './evaluation/service/evaluationService.js';
export * from './multilingual/types/multilingualTypes.js';
export * from './multilingual/detector/languageDetector.js';
export * from './multilingual/normalizer/indicNormalizer.js';
export * from './multilingual/sentiment/multilingualSentiment.js';
export * from './multilingual/repositories/multilingualRepository.js';
export * from './multilingual/service/multilingualService.js';
export * from './security/hardening/types/securityHardeningTypes.js';
export * from './security/hardening/ledger/cryptoAuditLedger.js';
export * from './security/hardening/rotation/secretRotationEngine.js';
export * from './security/hardening/scanner/zeroTrustScanner.js';
export * from './security/hardening/repositories/securityHardeningRepository.js';
export * from './security/hardening/service/securityHardeningService.js';
export * from './reliability/types/reliabilityTypes.js';
export * from './reliability/idempotency/idempotencyManager.js';
export * from './reliability/circuit/bulkheadCircuitBreaker.js';
export * from './reliability/dlq/deadLetterQueueManager.js';
export * from './reliability/recovery/stateRecoveryEngine.js';
export * from './reliability/repositories/reliabilityRepository.js';
export * from './reliability/service/reliabilityService.js';
export * from './model/resilience/types/modelResilienceTypes.js';
export * from './model/resilience/adapters/modelProviderAdapter.js';
export * from './model/resilience/router/dynamicModelRouter.js';
export * from './model/resilience/fallback/modelFallbackManager.js';
export * from './model/resilience/repositories/modelResilienceRepository.js';
export * from './model/resilience/service/modelResilienceService.js';
export * from './cost/types/costTypes.js';
export * from './cost/attribution/costAttributionEngine.js';
export * from './cost/outcomes/outcomeUnitEconomicsEngine.js';
export * from './cost/budget/budgetEnforcer.js';
export * from './cost/repositories/costRepository.js';
export * from './cost/service/costService.js';
export * from './governance/types/governanceTypes.js';
export * from './governance/org/organizationHierarchyEngine.js';
export * from './governance/abac/abacPolicyEvaluator.js';
export * from './governance/sso/enterpriseSsoAdapter.js';
export * from './governance/retention/dataRetentionPurgePlanner.js';
export * from './governance/repositories/governanceRepository.js';
export * from './governance/service/governanceService.js';
export * from './admin/types/adminTypes.js';
export * from './admin/lifecycle/tenantLifecycleEngine.js';
export * from './admin/fleet/fleetHealthDiagnostics.js';
export * from './admin/maintenance/maintenanceManager.js';
export * from './admin/repositories/adminRepository.js';
export * from './admin/service/adminService.js';
export * from './billing/types/billingTypes.js';
export * from './billing/pricing/channelPricingCatalog.js';
export * from './billing/metering/usageMeteringEngine.js';
export * from './billing/overage/overageEvaluator.js';
export * from './billing/invoicing/invoiceGenerator.js';
export * from './billing/stripe/stripePaymentAdapter.js';
export * from './billing/repositories/billingRepository.js';
export * from './billing/service/billingService.js';
export * from './infrastructure/types/infrastructureTypes.js';
export * from './infrastructure/queue/workerQueueManager.js';
export * from './infrastructure/pool/connectionPoolManager.js';
export * from './infrastructure/secrets/secretAuditEngine.js';
export * from './infrastructure/repositories/infrastructureRepository.js';
export * from './infrastructure/service/infrastructureService.js';
export * from './sre/types/sreTypes.js';
export * from './sre/waterfall/waterfallTraceVisualizer.js';
export * from './sre/slo/sloBurnRateTracker.js';
export * from './sre/alerts/structuredAlertDispatcher.js';
export * from './sre/repositories/sreRepository.js';
export * from './sre/service/sreService.js';
export * from './deployment/types/deploymentTypes.js';
export * from './deployment/gates/deploymentGateEvaluator.js';
export * from './deployment/flags/featureFlagEngine.js';
export * from './deployment/canary/canaryTrafficShifter.js';
export * from './deployment/schema/schemaTransitionManager.js';
export * from './deployment/repositories/deploymentRepository.js';
export * from './deployment/service/deploymentService.js';
export * from './hardening/types/hardeningTypes.js';
export * from './hardening/stress/concurrencyStressTester.js';
export * from './hardening/chaos/chaosInjectionEngine.js';
export * from './hardening/security/redTeamValidator.js';
export * from './hardening/readiness/productionReadinessAuditor.js';
export * from './hardening/repositories/hardeningRepository.js';
export * from './hardening/service/hardeningService.js';
export * from './retrieval/external/types/externalRetrievalTypes.js';
export * from './retrieval/external/query/queryBuilder.js';
export * from './retrieval/external/scrubber/piiScrubber.js';
export * from './retrieval/external/gateway/egressGateway.js';
export * from './retrieval/external/fetcher/isolatedFetcher.js';
export * from './retrieval/external/sanitizer/contentSanitizer.js';
export * from './retrieval/external/wrapper/isolationWrapper.js';
export * from './retrieval/external/governance/externalFactGovernance.js';
export * from './retrieval/external/repositories/externalRetrievalRepository.js';
export * from './retrieval/external/services/securedRetrievalPipeline.js';
export * from './realtime/types/realtimeTypes.js';
export * from './realtime/repositories/realtimeEventRepository.js';
export * from './realtime/services/realtimeStreamHub.js';
export * from './adaptation/types/adaptationTypes.js';
export * from './adaptation/repositories/adaptationRepository.js';
export * from './adaptation/services/failureClusteringService.js';
export * from './adaptation/services/remediationProposalService.js';
export * from './adaptation/services/adaptationSimulationEngine.js';
export * from './adaptation/services/governedAdaptationService.js';
export * from './reach/types/reachTypes.js';
export * from './reach/security/reachSecurityPolicy.js';
export * from './reach/security/reachKillSwitch.js';
export * from './reach/driver/browserDriver.js';
export * from './reach/repositories/reachSessionRepository.js';
export * from './reach/service/reachBrowserService.js';
export * from './reach/service/reachTools.js';
export * from './interop/mcp/types/mcpTypes.js';
export * from './interop/mcp/service/mcpSchemaConverter.js';
export * from './interop/mcp/service/mcpActionServer.js';
export * from './interop/mcp/transport/stdioTransport.js';
export * from './api/routes/mcpRoutes.js';
export * from './outcomes/types/outcomeKpiTypes.js';
export * from './outcomes/repositories/outcomeKpiRepository.js';
export * from './outcomes/service/outcomeInstrumentationService.js';
export * from './deployment/types/deploymentTypes.js';
export * from './deployment/repositories/deploymentRepository.js';
export * from './deployment/canary/canaryRoutingEngine.js';
export * from './deployment/rollback/oneStepRollbackEngine.js';
export * from './deployment/versioning/apiVersionManager.js';
export * from './deployment/residency/dataResidencyEngine.js';
export * from './deployment/gate/launchGateTypes.js';
export * from './deployment/gate/launchGateReviewEngine.js';
export * from './api/routes/outcomeRoutes.js';
export * from './api/routes/deploymentRoutes.js';
export * from './api/server.js';

export interface PlatformHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  environment: string;
  uptimeSeconds: number;
  database: {
    status: 'connected' | 'disconnected';
    driver: string;
  };
}

export class KriyaPlatform {
  private static startTime = Date.now();

  public static async bootstrap(): Promise<void> {
    logger.info('Bootstrapping Kriya AI Platform Foundation...');
    logger.info('Active configuration:', config.getRedacted());
    // Fail fast on unsafe configuration (docs/kriya WP-0.3) — before touching storage.
    assertRuntimeReadiness();
    logger.info(`Runtime mode: ${getAppMode()}`);

    try {
      const client = db.getClient();
      const migrator = new SchemaMigrator(client);
      const applied = await migrator.applyMigrations();
      logger.info(`Schema migrations checked. Applied: ${applied.length} new migrations.`);

      await ensurePlatformOwner();

      logger.info('Kriya AI Platform Foundation successfully initialized.');
    } catch (err) {
      logger.fatal('Fatal error during platform bootstrap', err);
      throw err;
    }
  }

  public static async getHealth(): Promise<PlatformHealth> {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    let dbStatus: 'connected' | 'disconnected' = 'disconnected';

    try {
      const client = db.getClient();
      const res = await client.queryOne('SELECT 1 as alive;');
      if (res && (res as any).alive === 1) {
        dbStatus = 'connected';
      }
    } catch (err) {
      logger.error('Health check database query failed', err);
    }

    return {
      status: dbStatus === 'connected' ? 'healthy' : 'unhealthy',
      version: '1.0.0',
      environment: config.get('NODE_ENV'),
      uptimeSeconds,
      database: {
        status: dbStatus,
        driver: config.get('DB_DRIVER'),
      },
    };
  }

  public static async shutdown(): Promise<void> {
    logger.info('Gracefully shutting down Kriya Platform...');
    await db.close();
    logger.info('Kriya Platform shutdown complete.');
  }

  public static async startServer(port = 3000): Promise<void> {
    await this.bootstrap();
    const server = await buildServer();
    const listenPort = Number(config.get('PORT') || port);
    await server.listen({ port: listenPort, host: '0.0.0.0' });
    logger.info(`🚀 Kriya AI Autonomous Business Workforce Server running at http://localhost:${listenPort}`);
    logger.info(`Client admin portal: /admin · Platform owner console: /owner`);
  }
}

// Auto-boot if executed directly as entry script
const isMain = process.argv[1] && (
  process.argv[1].endsWith('index.js') ||
  process.argv[1].endsWith('index.ts') ||
  process.argv[1].endsWith('src\\index.ts') ||
  process.argv[1].endsWith('dist\\index.js')
);

if (isMain) {
  KriyaPlatform.startServer().catch((err) => {
    logger.fatal('Failed to start server', err);
    process.exit(1);
  });
}
