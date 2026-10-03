/**
 * Kriya AI — Document (Lens) Type Definitions
 * Structured extraction contracts, validation schemas, and zero-retention metadata (docs/kriya WP-4.5).
 */

import { z } from 'zod';
import { BaseEntity } from '../../storage/repositories/baseRepository.js';

export const DocumentTypeEnum = z.enum([
  'lab_report',
  'prescription',
  'invoice',
  'id_card',
  'receipt',
  'leave_notice',
  'generic',
]);
export type DocumentType = z.infer<typeof DocumentTypeEnum>;

export const ExtractionMethodEnum = z.enum([
  'L0_deterministic',
  'L2_fast_model',
  'L3_reasoning_model',
]);
export type ExtractionMethod = z.infer<typeof ExtractionMethodEnum>;

export const DocumentStatusEnum = z.enum([
  'verified',
  'low_confidence',
  'unsupported_template',
  'failed',
]);
export type DocumentStatus = z.infer<typeof DocumentStatusEnum>;

// ============================================================================
// Specialized Structured Document Schemas
// ============================================================================

export const LabResultParameterSchema = z.object({
  parameter: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  unit: z.string().optional(),
  referenceRange: z.string().optional(),
  flag: z.enum(['normal', 'low', 'high', 'abnormal', 'critical']).default('normal'),
});

export const LabReportDataSchema = z.object({
  patientName: z.string().optional(),
  patientAge: z.number().int().optional(),
  patientGender: z.string().optional(),
  testDate: z.string().optional(),
  labName: z.string().optional(),
  referringDoctor: z.string().optional(),
  parameters: z.array(LabResultParameterSchema).min(1),
  notes: z.string().optional(),
});
export type LabReportData = z.infer<typeof LabReportDataSchema>;

export const PrescriptionMedicationSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().min(1),
  frequency: z.string().min(1),
  duration: z.string().optional(),
  instructions: z.string().optional(),
});

export const PrescriptionDataSchema = z.object({
  doctorName: z.string().min(1),
  doctorRegistration: z.string().optional(),
  clinicName: z.string().optional(),
  patientName: z.string().optional(),
  date: z.string().min(1),
  diagnosis: z.string().optional(),
  medications: z.array(PrescriptionMedicationSchema).min(1),
  notes: z.string().optional(),
});
export type PrescriptionData = z.infer<typeof PrescriptionDataSchema>;

export const InvoiceLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative(),
});

export const InvoiceDataSchema = z.object({
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string().min(1),
  dueDate: z.string().optional(),
  vendorName: z.string().min(1),
  customerName: z.string().optional(),
  currency: z.string().default('INR'),
  lineItems: z.array(InvoiceLineItemSchema).min(1),
  subtotal: z.number().nonnegative(),
  taxAmount: z.number().nonnegative().default(0),
  grandTotal: z.number().nonnegative(),
});
export type InvoiceData = z.infer<typeof InvoiceDataSchema>;

export const IdCardDataSchema = z.object({
  idType: z.enum(['aadhaar', 'pan', 'passport', 'driving_license', 'national_id', 'other']),
  idNumber: z.string().min(1),
  maskedIdNumber: z.string().min(1),
  holderName: z.string().min(1),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  expiryDate: z.string().optional(),
});
export type IdCardData = z.infer<typeof IdCardDataSchema>;

export const GenericDocumentDataSchema = z.object({
  title: z.string().optional(),
  keyValues: z.record(z.string()),
  summary: z.string().optional(),
});
export type GenericDocumentData = z.infer<typeof GenericDocumentDataSchema>;

export const DoctorLeaveDataSchema = z.object({
  doctorName: z.string().min(1),
  leaveStart: z.string().min(1),
  leaveEnd: z.string().min(1),
  reason: z.string().default('Emergency Medical Leave'),
  isEmergency: z.boolean().default(true),
  clinicOrHospital: z.string().optional(),
  contactNumber: z.string().optional(),
});
export type DoctorLeaveData = z.infer<typeof DoctorLeaveDataSchema>;

// Map Document Type to its Schema
export const DOCUMENT_SCHEMA_MAP: Record<DocumentType, z.ZodTypeAny> = {
  lab_report: LabReportDataSchema,
  prescription: PrescriptionDataSchema,
  invoice: InvoiceDataSchema,
  id_card: IdCardDataSchema,
  receipt: InvoiceDataSchema,
  leave_notice: DoctorLeaveDataSchema,
  generic: GenericDocumentDataSchema,
};

// ============================================================================
// Entity & Service IO Contracts
// ============================================================================

export interface ParsedDocumentRecord extends BaseEntity {
  correlation_id: string;
  run_id?: string | null;
  document_type: DocumentType;
  sha256_hash: string;
  extraction_method: ExtractionMethod;
  confidence: number;
  is_valid: number;
  structured_data_json: string;
  validation_errors_json?: string | null;
  status: DocumentStatus;
}

export const ParseDocumentInputSchema = z.object({
  rawContent: z.string().min(1),
  documentType: DocumentTypeEnum.optional(),
  correlationId: z.string().optional(),
  runId: z.string().optional(),
  confidenceThreshold: z.number().min(0).max(1).default(0.75),
});
export type ParseDocumentInput = z.input<typeof ParseDocumentInputSchema>;

export interface ParseDocumentResult {
  id: string;
  documentType: DocumentType;
  sha256Hash: string;
  extractionMethod: ExtractionMethod;
  confidence: number;
  isValid: boolean;
  structuredData: Record<string, unknown>;
  validationErrors: string[];
  status: DocumentStatus;
  escalatedToAttention: boolean;
  attentionItemId?: string;
}
