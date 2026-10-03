/**
 * Kriya Omnitask — Explicit Layered Context Assembler (§8.3, §8.5, §23)
 * Assembles in-window working context per turn from a budget (never accumulative).
 * Prioritizes stable prefix layers (System + Tenant frames) for prompt caching,
 * and strictly guards Layers 1–4 against token pressure dropping.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { PolicyViolationError } from '../../core/errors/errors.js';
import {
  LayeredContextAssembly,
  ConversationTurn,
  RetrievedFact,
  ExternalDataBlock,
} from '../types/contextTypes.js';

export interface AssembleContextOptions {
  systemFrame: string;
  tenantFrame: string;
  taskFrame: string;
  retrievedFacts?: RetrievedFact[];
  externalData?: ExternalDataBlock;
  recentTurns?: ConversationTurn[];
  rollingSummary?: string;
  maxBudgetTokens?: number; // E.g., 8000
}

export class ContextAssembler {
  // In-memory cache for prompt prefix hits
  private static prefixCache: Set<string> = new Set();

  /**
   * Estimates token count for a text string (~4 chars per token).
   */
  public static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Computes SHA-256 hash for the stable prompt prefix (Layers 1 & 2).
   */
  public static computePrefixHash(systemFrame: string, tenantFrame: string): string {
    const combined = `[SYSTEM_FRAME]\n${systemFrame}\n[TENANT_FRAME]\n${tenantFrame}`;
    return CryptoUtils.hashSha256(combined);
  }

  /**
   * Assembles a layered context per turn from a token budget (§8.3).
   */
  public static assemble(options: AssembleContextOptions): LayeredContextAssembly {
    const maxBudget = options.maxBudgetTokens || 8000;
    const droppedLayers: number[] = [];
    const truncatedLayers: number[] = [];

    // 1. Layer 1: System Frame (Cached, Stable)
    const layer1 = options.systemFrame.trim();
    const l1Tokens = this.estimateTokens(layer1);

    // 2. Layer 2: Tenant Frame (Cached, Stable per Tenant)
    const layer2 = options.tenantFrame.trim();
    const l2Tokens = this.estimateTokens(layer2);

    // 3. Layer 3: Task Frame (Current Task)
    const layer3 = options.taskFrame.trim();
    const l3Tokens = this.estimateTokens(layer3);

    // 4. Layer 4: Retrieved Facts (from Tier 1 & Tier 2)
    const facts = options.retrievedFacts || [];
    const factsText = facts.length > 0
      ? facts.map((f) => `- [${f.source}] (Trust Tier ${f.trustTier || 'A'}): ${f.fact}`).join('\n')
      : 'None';
    const l4Tokens = this.estimateTokens(factsText);

    // Inviolable Layers 1–4 Token Total (§8.3)
    const coreLayersTokens = l1Tokens + l2Tokens + l3Tokens + l4Tokens;

    if (coreLayersTokens > maxBudget) {
      throw new PolicyViolationError(
        `Token budget violation: Inviolable Layers 1–4 require ${coreLayersTokens} tokens, which exceeds the max allocation of ${maxBudget} tokens. An agent cannot run without its system rules, tenant identity, task scope, or established facts. Escalating.`,
        { coreLayersTokens, maxBudget }
      );
    }

    let remainingBudget = maxBudget - coreLayersTokens;

    // 5. Layer 5: External Data Block (Untrusted, Fenced, Labeled - §10.3)
    let layer5 = options.externalData;
    let l5Tokens = 0;
    if (layer5) {
      const extText = `[UNTRUSTED_EXTERNAL_DATA - Trust Tier ${layer5.trustTier || 'C'}]\nSource: ${layer5.sourceUrl || 'external'}\nRetrieved At: ${layer5.retrievedAt}\nContent:\n${layer5.content}\n[/UNTRUSTED_EXTERNAL_DATA]`;
      l5Tokens = this.estimateTokens(extText);
      if (l5Tokens > remainingBudget) {
        // Truncate external data to fit
        const charBudget = Math.max(100, remainingBudget * 4);
        layer5 = {
          ...layer5,
          content: layer5.content.slice(0, charBudget) + '\n... [TRUNCATED DUE TO TOKEN BUDGET]',
        };
        truncatedLayers.push(5);
        l5Tokens = remainingBudget;
      }
      remainingBudget -= l5Tokens;
    }

    // 6. Layer 7: Rolling Summary (Compacted older turns, if budget remains)
    // Check if we can include Layer 7 without crowding out recent turns
    let layer7 = options.rollingSummary;
    let l7Tokens = 0;
    if (layer7 && layer7.trim().length > 0) {
      const summaryTokens = this.estimateTokens(layer7);
      // Under pressure, drop Layer 7 before Layer 6 (§8.3)
      if (summaryTokens > remainingBudget * 0.4 || remainingBudget < 300) {
        droppedLayers.push(7);
        layer7 = undefined;
      } else {
        l7Tokens = summaryTokens;
        remainingBudget -= l7Tokens;
      }
    }

    // 7. Layer 6: Recent Turns (Verbatim, most recent first, until budget spent)
    const rawTurns = [...(options.recentTurns || [])];
    const includedTurns: ConversationTurn[] = [];

    // Process most recent turns first
    const reversedTurns = [...rawTurns].reverse();
    for (const turn of reversedTurns) {
      const turnText = `${turn.speaker.toUpperCase()}: ${turn.content}`;
      const turnTokens = this.estimateTokens(turnText);
      if (turnTokens <= remainingBudget) {
        includedTurns.unshift(turn); // restore chronological order
        remainingBudget -= turnTokens;
      } else {
        truncatedLayers.push(6);
        break;
      }
    }

    // Prefix Caching Check (§8.5)
    const prefixHash = this.computePrefixHash(layer1, layer2);
    const isPrefixCached = this.prefixCache.has(prefixHash);
    this.prefixCache.add(prefixHash);

    // Build the final formatted prompt with strict fencing
    let formattedPrompt = `=== LAYER 1: SYSTEM FRAME ===\n${layer1}\n\n`;
    formattedPrompt += `=== LAYER 2: TENANT FRAME ===\n${layer2}\n\n`;
    formattedPrompt += `=== LAYER 3: TASK FRAME ===\n${layer3}\n\n`;
    formattedPrompt += `=== LAYER 4: ESTABLISHED FACTS (TIER 1 & 2) ===\n${factsText}\n\n`;

    if (layer5) {
      formattedPrompt += `=== LAYER 5: EXTERNAL DATA (UNTRUSTED) ===\n[UNTRUSTED_EXTERNAL_DATA - Trust Tier ${layer5.trustTier}]\nSource: ${layer5.sourceUrl || 'external'}\nRetrieved: ${layer5.retrievedAt}\nContent:\n${layer5.content}\n[/UNTRUSTED_EXTERNAL_DATA]\n\n`;
    }

    if (layer7) {
      formattedPrompt += `=== LAYER 7: COMPACTED ROLLING SUMMARY ===\n${layer7}\n\n`;
    }

    if (includedTurns.length > 0) {
      formattedPrompt += `=== LAYER 6: RECENT TURNS ===\n`;
      for (const turn of includedTurns) {
        formattedPrompt += `[Turn ${turn.turnIndex}] ${turn.speaker.toUpperCase()}: ${turn.content}\n`;
      }
    }

    const totalAssembledTokens = this.estimateTokens(formattedPrompt);

    return {
      layer1SystemFrame: layer1,
      layer2TenantFrame: layer2,
      layer3TaskFrame: layer3,
      layer4RetrievedFacts: facts,
      layer5ExternalData: layer5,
      layer6RecentTurns: includedTurns,
      layer7RollingSummary: layer7,
      totalAssembledTokens,
      prefixHash,
      isPrefixCached,
      droppedLayers,
      truncatedLayers,
      formattedPrompt,
    };
  }

  /**
   * Resets the prefix cache (useful in tests).
   */
  public static clearPrefixCache(): void {
    this.prefixCache.clear();
  }
}
