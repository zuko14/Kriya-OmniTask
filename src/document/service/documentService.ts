/**
 * Kriya AI — Document (Lens) Service
 * Orchestrates L0 deterministic parsing, L2/L3 model cascade extraction, schema validation,
 * zero-retention compliance, and low-confidence human attention escalation (docs/kriya WP-4.5).
 */

import { z } from 'zod';
import { DatabaseClient } from '../../storage/db.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import {
  DocumentType,
  ExtractionMethod,
  DocumentStatus,
  ParseDocumentInput,
  ParseDocumentInputSchema,
  ParseDocumentResult,
  ParsedDocumentRecord,
  DOCUMENT_SCHEMA_MAP,
} from '../types/documentTypes.js';
import { tryDeterministicParse } from '../parsers/deterministicParsers.js';
import { DocumentRepository } from '../repositories/documentRepository.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { ModelGateway } from '../../model/gateway/modelGateway.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class DocumentService {
  private documentRepo: DocumentRepository;
  private attention: AttentionService;

  constructor(
    private readonly client?: DatabaseClient,
    private readonly gateway?: ModelGateway,
    attention?: AttentionService,
    documentRepo?: DocumentRepository
  ) {
    this.documentRepo = documentRepo || new DocumentRepository(client);
    this.attention = attention || new AttentionService(client);
  }

  /**
   * Parses and validates a document with zero-retention compliance.
   * Order: L0 deterministic matching → L2/L3 model extraction → human Attention escalation.
   */
  public async parseDocument(input: ParseDocumentInput): Promise<ParseDocumentResult> {
    const validatedInput = ParseDocumentInputSchema.parse(input);
    const correlationId = validatedInput.correlationId || CryptoUtils.generateCorrelationId();
    const sha256Hash = CryptoUtils.hashSha256(validatedInput.rawContent);
    const threshold = validatedInput.confidenceThreshold ?? 0.75;

    // Check existing parse cache for this tenant & document hash
    const existing = await this.documentRepo.findByHash(sha256Hash);
    if (existing && existing.status === 'verified') {
      let structuredData: Record<string, unknown> = {};
      try {
        structuredData = JSON.parse(existing.structured_data_json);
      } catch {
        structuredData = {};
      }
      return {
        id: existing.id,
        documentType: existing.document_type,
        sha256Hash: existing.sha256_hash,
        extractionMethod: existing.extraction_method,
        confidence: existing.confidence,
        isValid: existing.is_valid === 1,
        structuredData,
        validationErrors: [],
        status: existing.status,
        escalatedToAttention: false,
      };
    }

    // Step 1: L0 Deterministic Parser
    const l0 = tryDeterministicParse(validatedInput.rawContent, validatedInput.documentType);
    let documentType: DocumentType = l0.documentType;
    let extractionMethod: ExtractionMethod = 'L0_deterministic';
    let confidence = l0.confidence;
    let structuredData: Record<string, unknown> = {};
    let validationErrors: string[] = [];
    let isValid = false;

    if (l0.matched && l0.data) {
      const schema = DOCUMENT_SCHEMA_MAP[documentType];
      const validation = schema.safeParse(l0.data);
      if (validation.success) {
        isValid = true;
        structuredData = validation.data as Record<string, unknown>;
      } else {
        validationErrors = validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
      }
    }

    // Step 2: L2/L3 Model Gateway Extraction (if L0 didn't achieve sufficient confidence)
    if (!isValid || confidence < threshold) {
      if (this.gateway) {
        try {
          const targetType = validatedInput.documentType || documentType || 'generic';
          const schema = DOCUMENT_SCHEMA_MAP[targetType];
          const prompt =
            `Extract structured data from the following document into the required schema.\n` +
            `Document text:\n"""\n${validatedInput.rawContent.slice(0, 4000)}\n"""\n` +
            `Never invent values. If a field is not mentioned, leave it undefined.`;

          const res = await this.gateway.complete({
            tenantId: this.documentRepo['getTenantId'](),
            taskId: `doc_parse_${correlationId}`,
            tier: 'T2',
            systemPrompt: 'You are a high-accuracy zero-retention document parsing specialist.',
            userPrompt: prompt,
            schema,
            temperature: 0,
          });

          const validation = schema.safeParse(res.parsed);
          if (validation.success) {
            isValid = true;
            confidence = 0.88;
            extractionMethod = 'L2_fast_model';
            documentType = targetType;
            structuredData = validation.data as Record<string, unknown>;
            validationErrors = [];
          } else {
            validationErrors = validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
          }
        } catch (err) {
          logger.warn(`[DOCUMENT SERVICE] Model Gateway extraction threw: ${(err as Error).message}`);
          validationErrors.push((err as Error).message);
        }
      } else if (!l0.matched) {
        validationErrors.push('No deterministic template matched and Model Gateway not configured.');
      }
    }

    // Step 3: Determine Final Status
    let status: DocumentStatus = 'verified';
    let escalatedToAttention = false;
    let attentionItemId: string | undefined;

    if (!isValid || confidence < threshold) {
      status = 'low_confidence';
      escalatedToAttention = true;

      // Fail-closed: Escalate to human Attention Center
      const attentionItem = await this.attention.escalateOnce({
        correlationId: `doc_parse:${correlationId}`,
        channel: 'internal',
        sourceAgentId: 'specialist.document',
        title: `Low confidence document parse (${documentType}, ${(confidence * 100).toFixed(0)}%)`,
        description:
          `Document hash ${sha256Hash.slice(0, 12)}... failed high-confidence extraction. ` +
          `Errors: ${validationErrors.join('; ') || 'Unrecognized layout'}`,
        reasonCategory: 'low_confidence',
        priority: 'P2_MEDIUM',
        contextData: {
          correlationId,
          sha256Hash,
          documentType,
          confidence,
          validationErrors,
        },
        recommendedAction: 'Manually inspect document and key structured fields.',
      });
      attentionItemId = attentionItem.id;
    }

    // Step 4: Zero-Retention Persistence (store only structured fields & verification hash)
    const record = await this.documentRepo.saveParsedDocument({
      correlationId,
      runId: validatedInput.runId,
      documentType,
      sha256Hash,
      extractionMethod,
      confidence,
      isValid,
      structuredData,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      status,
    });

    return {
      id: record.id,
      documentType,
      sha256Hash,
      extractionMethod,
      confidence,
      isValid,
      structuredData,
      validationErrors,
      status,
      escalatedToAttention,
      attentionItemId,
    };
  }

  /**
   * Retrieves a parsed document record by ID.
   */
  public async getDocument(id: string): Promise<ParsedDocumentRecord> {
    const doc = await this.documentRepo.findById(id);
    if (!doc) throw new NotFoundError(`Parsed document '${id}' not found.`);
    return doc;
  }

  /**
   * Retrieves a parsed document record by its SHA-256 hash.
   */
  public async getByHash(hash: string): Promise<ParsedDocumentRecord | null> {
    return this.documentRepo.findByHash(hash);
  }

  /**
   * Validates structured data against a specific document schema.
   */
  public validateSchema(documentType: DocumentType, data: unknown): { isValid: boolean; errors: string[] } {
    const schema = DOCUMENT_SCHEMA_MAP[documentType];
    if (!schema) return { isValid: false, errors: [`Unknown document type: ${documentType}`] };

    const res = schema.safeParse(data);
    if (res.success) return { isValid: true, errors: [] };
    return {
      isValid: false,
      errors: res.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    };
  }
}
