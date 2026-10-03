/**
 * Kriya AI — Document (Lens) Tools
 * Built-in registered tools for zero-retention parsing, validation, and retrieval (docs/kriya WP-4.5).
 */

import { z } from 'zod';
import { RegisteredTool } from '../../tools/registry/toolRegistry.js';
import { DocumentService } from './documentService.js';
import {
  DocumentTypeEnum,
  ParseDocumentInputSchema,
} from '../types/documentTypes.js';

export function documentTools(
  serviceFactory: () => DocumentService = () => new DocumentService()
): RegisteredTool[] {
  return [
    {
      definition: {
        slug: 'doc_parse',
        name: 'Document Parse',
        description:
          'Parses and extracts structured fields from document content with zero-retention compliance. ' +
          'Applies deterministic L0 template matching first, falling back to L2/L3 model cascade. ' +
          'Low confidence parses automatically escalate to the Human Attention Center.',
        category: 'custom',
        riskTier: 'MEDIUM',
        requiresApproval: false,
        inputSchema: {
          rawContent: 'string (document text / markdown / OCR payload)',
          documentType: 'lab_report | prescription | invoice | id_card | receipt | generic (optional)',
          correlationId: 'string (optional)',
          confidenceThreshold: 'number (optional, default 0.75)',
        },
        outputSchema: { result: 'ParseDocumentResult' },
        isSystem: true,
      },
      inputValidator: ParseDocumentInputSchema,
      handler: async (input) => {
        const service = serviceFactory();
        const result = await service.parseDocument(input as any);
        return { result: result as unknown as Record<string, unknown> };
      },
      verify: async (input, output) => {
        const service = serviceFactory();
        const res = output.result as { id?: string; sha256Hash?: string; status?: string } | undefined;
        if (!res?.id) return { state: 'mismatch', observed: { error: 'No document id in output' } };

        const doc = await service.getDocument(res.id);
        const verified = doc.sha256_hash === res.sha256Hash && doc.status === res.status;
        return {
          state: verified ? 'verified' : 'mismatch',
          observed: { id: doc.id, sha256Hash: doc.sha256_hash, status: doc.status },
        };
      },
    },
    {
      definition: {
        slug: 'doc_validate_schema',
        name: 'Document Validate Schema',
        description: 'Validates an extracted structured object against a specific document type schema.',
        category: 'custom',
        riskTier: 'LOW',
        requiresApproval: false,
        inputSchema: {
          documentType: 'lab_report | prescription | invoice | id_card | receipt | generic',
          data: 'record (structured fields)',
        },
        outputSchema: { isValid: 'boolean', errors: 'string[]' },
        isSystem: true,
      },
      inputValidator: z.object({
        documentType: DocumentTypeEnum,
        data: z.record(z.unknown()),
      }),
      handler: async (input) => {
        const service = serviceFactory();
        const res = service.validateSchema(input.documentType as any, input.data);
        return { isValid: res.isValid, errors: res.errors };
      },
    },
    {
      definition: {
        slug: 'doc_get_parsed',
        name: 'Document Get Parsed',
        description: 'Retrieves structured document record and hashes by document ID, hash, or correlation ID.',
        category: 'custom',
        riskTier: 'LOW',
        requiresApproval: false,
        inputSchema: {
          documentId: 'string (optional)',
          sha256Hash: 'string (optional)',
        },
        outputSchema: { document: 'ParsedDocumentRecord' },
        isSystem: true,
      },
      inputValidator: z.object({
        documentId: z.string().optional(),
        sha256Hash: z.string().optional(),
      }).refine((d) => d.documentId || d.sha256Hash, 'Either documentId or sha256Hash is required'),
      handler: async (input) => {
        const service = serviceFactory();
        let doc;
        if (input.documentId) {
          doc = await service.getDocument(input.documentId as string);
        } else if (input.sha256Hash) {
          doc = await service.getByHash(input.sha256Hash as string);
        }
        return { document: doc as unknown as Record<string, unknown> };
      },
    },
  ];
}
