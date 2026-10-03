#!/usr/bin/env node
/**
 * Kriya AI — Evals-as-CI CLI Runner (WP-6.2)
 * Command-line runner for automated CI pipelines and deployment gating (§14, §18 of CLAUDE.md).
 *
 * Usage:
 *   npx tsx src/evaluation/ci/cli/runCiEvals.ts
 *   npx tsx src/evaluation/ci/cli/runCiEvals.ts --agent intake --strict
 *   npx tsx src/evaluation/ci/cli/runCiEvals.ts --swap-from deepseek-v4 --swap-to gemini-2.5-flash
 */

import { EvalsAsCiService } from '../service/evalsAsCiService.js';
import { AgentSlug } from '../types/evalCiTypes.js';
import { db } from '../../../storage/db.js';
import { SchemaMigrator } from '../../../storage/migrations/migrator.js';
import { TenantRepository } from '../../../storage/repositories/tenantRepository.js';

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  const hasFlag = (flag: string): boolean => args.includes(flag);

  const agent = getArg('--agent') as AgentSlug | undefined;
  const strict = hasFlag('--strict');
  const trials = parseInt(getArg('--trials') || '1', 10);
  const swapFrom = getArg('--swap-from');
  const swapTo = getArg('--swap-to');
  const tenantId = getArg('--tenant') || 'ci-runner-tenant';

  // Ensure DB schema and default runner tenant are initialized
  const migrator = new SchemaMigrator(db.getClient());
  await migrator.applyMigrations();
  const tenantRepo = new TenantRepository(db.getClient());
  const existingTenant = await tenantRepo.findById(tenantId);
  if (!existingTenant) {
    await tenantRepo.create({
      id: tenantId,
      name: 'CI Runner Tenant',
      slug: 'ci-runner',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    });
  }

  const service = new EvalsAsCiService();

  console.log('===============================================================');
  console.log(' KRIYA AI — EVALS-AS-CI REGRESSION GATING HARNESS');
  console.log('===============================================================\n');

  if (swapFrom && swapTo) {
    console.log(`[MODEL SWAP GATE] Evaluating proposed swap: '${swapFrom}' -> '${swapTo}'...`);
    const swapResult = await service.evaluateModelSwap({
      tenantId,
      currentModelId: swapFrom,
      proposedModelId: swapTo,
      agentSlugs: agent ? [agent] : undefined,
      passKTrials: trials,
      strictMode: strict,
    });

    console.log(`\nVerdict:              ${swapResult.verdict.toUpperCase()}`);
    console.log(`Baseline Pass Rate:   ${(swapResult.baselinePassRate * 100).toFixed(1)}%`);
    console.log(`Proposed Pass Rate:   ${(swapResult.proposedPassRate * 100).toFixed(1)}% (Delta: ${((swapResult.passRateDelta) * 100).toFixed(1)}%)`);
    console.log(`Safety Breaches:      ${swapResult.safetyBreachesCount}`);
    console.log(`Latency Delta:        ${swapResult.latencyDeltaMs}ms`);

    console.log('\nDetailed Reasons:');
    for (const r of swapResult.reasons) {
      console.log(`  - ${r}`);
    }

    if (swapResult.verdict === 'release_blocked_regression') {
      console.error('\n❌ CI GATE FAILED: Proposed model swap rejected due to regression or safety breaches.');
      process.exit(1);
    } else {
      console.log('\n✅ CI GATE PASSED: Proposed model swap approved for deployment.');
      process.exit(0);
    }
  }

  // Standard CI suite execution
  console.log(`[SUITE RUN] Running CI Golden Suites (Trials: ${trials}, Strict: ${strict})...\n`);
  const report = await service.runCiPipeline({
    tenantId,
    agentSlugs: agent ? [agent] : undefined,
    passKTrials: trials,
    strictMode: strict,
  });

  console.log('Agent Evaluation Breakdown:');
  console.log('----------------------------------------------------------------------');
  for (const [slug, aReport] of Object.entries(report.agentReports)) {
    const status = aReport.verdict === 'release_approved' ? 'PASS' : aReport.verdict === 'conditional_pass' ? 'COND' : 'FAIL';
    console.log(
      ` ${slug.padEnd(12)} | Status: ${status.padEnd(5)} | Pass Rate: ${(aReport.passRate * 100).toFixed(1).padStart(5)}% | Cases: ${String(aReport.passedCases).padStart(2)}/${aReport.totalCases} | Safety Breaches: ${aReport.criticalSafetyBreaches}`
    );
  }
  console.log('----------------------------------------------------------------------');

  console.log(`\nOverall Verdict:      ${report.overallVerdict.toUpperCase()}`);
  console.log(`Total Cases Evaluated:  ${report.totalTestCases}`);
  console.log(`Total Cases Passed:     ${report.passedTestCases} (${(report.passRate * 100).toFixed(1)}%)`);
  console.log(`Critical Safety Rate:   ${(report.criticalSafetyPassRate * 100).toFixed(1)}%`);

  if (report.blockers.length > 0) {
    console.log('\nBlockers:');
    for (const b of report.blockers) {
      console.error(`  - ${b}`);
    }
  }

  if (report.exitCode !== 0) {
    console.error('\n❌ EVALS-AS-CI PIPELINE FAILED: Regressions detected. Deployment blocked.');
    process.exit(1);
  } else {
    console.log('\n✅ EVALS-AS-CI PIPELINE PASSED: All release quality gates satisfied.');
    process.exit(0);
  }
}

if (process.argv[1]?.endsWith('runCiEvals.ts') || process.argv[1]?.endsWith('runCiEvals.js')) {
  main().catch((err) => {
    console.error('Fatal CLI execution error:', err);
    process.exit(1);
  });
}
