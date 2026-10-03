/**
 * Kriya AI — Deterministic L0 Document Parsers
 * Fast, zero-cost, template-based deterministic parsers for known document types (docs/kriya WP-4.5).
 */

import {
  DocumentType,
  LabReportData,
  PrescriptionData,
  InvoiceData,
  IdCardData,
  DoctorLeaveData,
} from '../types/documentTypes.js';

export interface DeterministicParseResult<T> {
  matched: boolean;
  data?: T;
  confidence: number;
}

// ============================================================================
// 1. Lab Report Deterministic Parser (L0)
// ============================================================================

export function parseDeterministicLabReport(text: string): DeterministicParseResult<LabReportData> {
  const isLabReport =
    /(?:lab(?:oratory)?|diagnostic|pathology|blood test|test report|panel|haemoglobin|cbc|lipid)/i.test(text);
  if (!isLabReport) return { matched: false, confidence: 0 };

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Extract metadata
  let patientName: string | undefined;
  let testDate: string | undefined;
  let labName: string | undefined;
  let referringDoctor: string | undefined;

  for (const line of lines) {
    const pMatch = line.match(/(?:patient(?: name)?|name)\s*[:|-]\s*([A-Za-z\s.]+)/i);
    if (pMatch && !patientName) patientName = pMatch[1].trim();

    const dMatch = line.match(/(?:date|test date|collected)\s*[:|-]\s*(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})/i);
    if (dMatch && !testDate) testDate = dMatch[1].trim();

    const lMatch = line.match(/(?:lab(?:oratory)?|center|clinic)\s*[:|-]\s*([A-Za-z0-9\s.,&]+)/i);
    if (lMatch && !labName) labName = lMatch[1].trim();

    const docMatch = line.match(/(?:ref(?:erred)? by|dr\.?|doctor)\s*[:|-]\s*([A-Za-z\s.]+)/i);
    if (docMatch && !referringDoctor) referringDoctor = docMatch[1].trim();
  }

  // Extract test parameters
  // Common formats:
  // "Haemoglobin: 14.5 g/dL (13.0 - 17.0)"
  // "Total Cholesterol | 195 | mg/dL | < 200"
  // "Glucose Fasting : 95 mg/dL [70 - 100]"
  const parameters: LabReportData['parameters'] = [];

  const paramRegex =
    /([A-Za-z\s()]+?)\s*[:|]\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z/%μuL]+)?\s*(?:[(|\[<]\s*([0-9.]+)?\s*[-–to<>]+\s*([0-9.]+)?\s*[)|\]])?/i;

  for (const line of lines) {
    const match = line.match(paramRegex);
    if (match) {
      const name = match[1].trim();
      // Filter out non-test labels
      if (/^(date|patient|name|age|gender|sex|phone|doctor|dr|ref|lab)$/i.test(name)) continue;

      const numVal = parseFloat(match[2]);
      const unit = match[3]?.trim();
      const minRef = match[4] ? parseFloat(match[4]) : undefined;
      const maxRef = match[5] ? parseFloat(match[5]) : undefined;

      let flag: 'normal' | 'low' | 'high' | 'abnormal' = 'normal';
      if (minRef !== undefined && numVal < minRef) flag = 'low';
      else if (maxRef !== undefined && numVal > maxRef) flag = 'high';

      const refRange = minRef !== undefined && maxRef !== undefined ? `${minRef} - ${maxRef}` : undefined;

      parameters.push({
        parameter: name,
        value: numVal,
        unit,
        referenceRange: refRange,
        flag,
      });
    }
  }

  if (parameters.length === 0) {
    return { matched: false, confidence: 0.3 };
  }

  const confidence = parameters.length >= 2 ? 0.95 : 0.85;
  return {
    matched: true,
    data: {
      patientName,
      testDate,
      labName,
      referringDoctor,
      parameters,
    },
    confidence,
  };
}

// ============================================================================
// 2. Prescription Deterministic Parser (L0)
// ============================================================================

export function parseDeterministicPrescription(text: string): DeterministicParseResult<PrescriptionData> {
  const isPrescription =
    /(?:rx|prescription|prescribed|dosage|sig\b|doctor|dr\.|m\.?b\.?b\.?s|clinic)/i.test(text);
  if (!isPrescription) return { matched: false, confidence: 0 };

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let doctorName = 'Attending Physician';
  let doctorRegistration: string | undefined;
  let clinicName: string | undefined;
  let patientName: string | undefined;
  let date: string = new Date().toISOString().slice(0, 10);
  let diagnosis: string | undefined;

  for (const line of lines) {
    const docMatch = line.match(/(?:dr\.?|doctor)\s*[:|-]?\s*([A-Za-z\s.]+)/i);
    if (docMatch && doctorName === 'Attending Physician') doctorName = docMatch[1].trim();

    const regMatch = line.match(/(?:reg(?:istration)?|license|mci|nmc)\s*(?:no\.?|#)?\s*[:|-]?\s*([A-Za-z0-9-]+)/i);
    if (regMatch && !doctorRegistration) doctorRegistration = regMatch[1].trim();

    const clinicMatch = line.match(/(?:clinic|hospital|centre)\s*[:|-]\s*([A-Za-z0-9\s.,&]+)/i);
    if (clinicMatch && !clinicName) clinicName = clinicMatch[1].trim();

    const pMatch = line.match(/(?:patient(?: name)?|name)\s*[:|-]\s*([A-Za-z\s.]+)/i);
    if (pMatch && !patientName) patientName = pMatch[1].trim();

    const dMatch = line.match(/(?:date)\s*[:|-]\s*(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})/i);
    if (dMatch) date = dMatch[1].trim();

    const diagMatch = line.match(/(?:diagnosis|dx)\s*[:|-]\s*([A-Za-z0-9\s.,-]+)/i);
    if (diagMatch && !diagnosis) diagnosis = diagMatch[1].trim();
  }

  // Medications parser
  // Matches e.g. "1. Tab Paracetamol 650mg - twice daily for 5 days"
  // or "Amoxicillin 500mg - 1-0-1 - 7 days"
  const medications: PrescriptionData['medications'] = [];
  const medRegex =
    /(?:^\d+\.\s*|rx\s*[:|-]?\s*|tab(?:let)?\.?\s*|cap(?:sule)?\.?\s*|syr(?:up)?\.?\s*)?([A-Za-z0-9\s]+?)\s+([0-9]+\s*(?:mg|mcg|ml|g))\s*(?:[-–|:]\s*([A-Za-z0-9\s-]+?))?(?:[-–|:]\s*([0-9]+\s*(?:days?|weeks?|months?)))?$/i;

  for (const line of lines) {
    // Exclude header / footer lines
    if (/(doctor|dr\.|patient|date|clinic|hospital|sign|reg|rx\b)/i.test(line) && line.length < 25) {
      continue;
    }
    const match = line.match(medRegex);
    if (match && match[1].trim().length > 2 && match[2]) {
      const name = match[1].trim().replace(/^(tab|cap|syr|inj)\.?\s+/i, '');
      const dosage = match[2].trim();
      const frequency = match[3]?.trim() || 'Once daily';
      const duration = match[4]?.trim();

      medications.push({
        name,
        dosage,
        frequency,
        duration,
      });
    }
  }

  if (medications.length === 0) {
    return { matched: false, confidence: 0.3 };
  }

  return {
    matched: true,
    data: {
      doctorName,
      doctorRegistration,
      clinicName,
      patientName,
      date,
      diagnosis,
      medications,
    },
    confidence: medications.length >= 1 ? 0.95 : 0.85,
  };
}

// ============================================================================
// 3. Invoice Deterministic Parser (L0)
// ============================================================================

export function parseDeterministicInvoice(text: string): DeterministicParseResult<InvoiceData> {
  const isInvoice =
    /(?:invoice|bill to|tax invoice|subtotal|grand total|amount due)/i.test(text);
  if (!isInvoice) return { matched: false, confidence: 0 };

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let invoiceNumber = 'INV-UNKNOWN';
  let invoiceDate = new Date().toISOString().slice(0, 10);
  let dueDate: string | undefined;
  let vendorName = 'Vendor';
  let customerName: string | undefined;
  let currency = 'INR';

  if (/\$|USD/i.test(text)) currency = 'USD';
  else if (/€|EUR/i.test(text)) currency = 'EUR';
  else if (/£|GBP/i.test(text)) currency = 'GBP';

  for (const line of lines) {
    const invMatch = line.match(/(?:invoice\s*(?:no\.?|#)|bill\s*(?:no\.?|#))\s*[:|-]?\s*([A-Za-z0-9-_]+)/i);
    if (invMatch) invoiceNumber = invMatch[1].trim();

    const dateMatch = line.match(/(?:invoice\s*date|date)\s*[:|-]\s*(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})/i);
    if (dateMatch) invoiceDate = dateMatch[1].trim();

    const dueMatch = line.match(/(?:due\s*date)\s*[:|-]\s*(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})/i);
    if (dueMatch) dueDate = dueMatch[1].trim();

    const vendMatch = line.match(/(?:vendor|from|billed by|seller)\s*[:|-]\s*([A-Za-z0-9\s.,&]+)/i);
    if (vendMatch && vendorName === 'Vendor') vendorName = vendMatch[1].trim();

    const custMatch = line.match(/(?:bill to|customer|client|to)\s*[:|-]\s*([A-Za-z0-9\s.,&]+)/i);
    if (custMatch && !customerName) customerName = custMatch[1].trim();
  }

  // Parse line items
  // Format: "1. Consultation Fee - Qty: 1 - Price: 150 - Total: 150"
  // or "Dental Cleaning | 1 | 80.00 | 80.00"
  const lineItems: InvoiceData['lineItems'] = [];
  const lineItemRegex =
    /(?:^\d+\.\s*)?([A-Za-z0-9\s-]+?)\s*(?:[|]|\s{2,}|\s-\s)\s*(\d+)\s*(?:[|]|\s{2,}|\s-\s)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:[|]|\s{2,}|\s-\s)\s*([0-9]+(?:\.[0-9]+)?)$/;

  let subtotal = 0;
  let taxAmount = 0;
  let grandTotal = 0;

  for (const line of lines) {
    const subMatch = line.match(/(?:subtotal|sub-total)\s*[:|-]?\s*[$₹€£]?\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (subMatch) subtotal = parseFloat(subMatch[1]);

    const taxMatch = line.match(/(?:tax|gst|vat)\s*[:|-]?\s*[$₹€£]?\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (taxMatch) taxAmount = parseFloat(taxMatch[1]);

    const totalMatch = line.match(/(?:grand total|total amount|total)\s*[:|-]?\s*[$₹€£]?\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (totalMatch) grandTotal = parseFloat(totalMatch[1]);

    const itemMatch = line.match(lineItemRegex);
    if (itemMatch) {
      const desc = itemMatch[1].trim();
      if (!/subtotal|total|tax|gst|balance|discount/i.test(desc)) {
        const qty = parseInt(itemMatch[2], 10);
        const unitPrice = parseFloat(itemMatch[3]);
        const total = parseFloat(itemMatch[4]);
        lineItems.push({
          description: desc,
          quantity: qty,
          unitPrice,
          total,
        });
      }
    }
  }

  // Compute calculated totals if missing
  if (lineItems.length > 0 && subtotal === 0) {
    subtotal = lineItems.reduce((acc, item) => acc + item.total, 0);
  }
  if (grandTotal === 0) {
    grandTotal = subtotal + taxAmount;
  }

  if (lineItems.length === 0 && grandTotal === 0) {
    return { matched: false, confidence: 0.3 };
  }

  return {
    matched: true,
    data: {
      invoiceNumber,
      invoiceDate,
      dueDate,
      vendorName,
      customerName,
      currency,
      lineItems: lineItems.length > 0 ? lineItems : [{ description: 'Services', quantity: 1, unitPrice: grandTotal, total: grandTotal }],
      subtotal,
      taxAmount,
      grandTotal,
    },
    confidence: 0.95,
  };
}

// ============================================================================
// 4. Identity Card Deterministic Parser (L0)
// ============================================================================

export function parseDeterministicIdCard(text: string): DeterministicParseResult<IdCardData> {
  const isIdCard =
    /(?:aadhaar|pan card|passport|driving licen[cs]e|identity card|govt of india|income tax department)/i.test(text);
  if (!isIdCard) return { matched: false, confidence: 0 };

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let idType: IdCardData['idType'] = 'other';
  let idNumber = '';
  let maskedIdNumber = '';
  let holderName = 'Card Holder';
  let dateOfBirth: string | undefined;
  let gender: string | undefined;
  let expiryDate: string | undefined;

  // 1. Check Aadhaar (12 digits, often formatted as 4-4-4)
  const aadhaarMatch = text.match(/\b([0-9]{4}\s[0-9]{4}\s[0-9]{4})\b|\b([0-9]{12})\b/);
  if (aadhaarMatch || /aadhaar/i.test(text)) {
    idType = 'aadhaar';
    const raw = (aadhaarMatch?.[1] || aadhaarMatch?.[2] || '000000000000').replace(/\s+/g, '');
    idNumber = raw;
    maskedIdNumber = `XXXX-XXXX-${raw.slice(-4)}`;
  }

  // 2. Check PAN Card (5 letters, 4 numbers, 1 letter)
  const panMatch = text.match(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/);
  if (panMatch || /pan\s*card/i.test(text)) {
    idType = 'pan';
    const raw = panMatch ? panMatch[1] : 'ABCDE1234F';
    idNumber = raw;
    maskedIdNumber = `XXXXX${raw.slice(5)}`;
  }

  // 3. Extract holder name, DOB, gender
  for (const line of lines) {
    const nameMatch = line.match(/(?:name|holder name)\s*[:|-]\s*([A-Za-z\s.]+)/i);
    if (nameMatch && holderName === 'Card Holder') holderName = nameMatch[1].trim();

    const dobMatch = line.match(/(?:dob|date of birth|birth date)\s*[:|-]\s*(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (dobMatch && !dateOfBirth) dateOfBirth = dobMatch[1].trim();

    const genderMatch = line.match(/(?:gender|sex)\s*[:|-]\s*(male|female|other)/i);
    if (genderMatch && !gender) gender = genderMatch[1].toLowerCase();

    const expMatch = line.match(/(?:valid thru|expires|expiry)\s*[:|-]\s*(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (expMatch && !expiryDate) expiryDate = expMatch[1].trim();
  }

  if (!idNumber) {
    return { matched: false, confidence: 0.3 };
  }

  return {
    matched: true,
    data: {
      idType,
      idNumber,
      maskedIdNumber,
      holderName,
      dateOfBirth,
      gender,
      expiryDate,
    },
    confidence: 0.95,
  };
}

// ============================================================================
// 5. Doctor Emergency Leave Parser (L0)
// ============================================================================

export function parseDeterministicDoctorLeave(text: string): DeterministicParseResult<DoctorLeaveData> {
  const isLeave = /(?:leave|absence|unwell|hospitalized|emergency leave|leave notice|medical certificate|sick leave)/i.test(text);
  const mentionsDoctor = /(?:dr\.?|doctor|physician|surgeon|డాక్టర్|डॉक्टर|டாக்டர்)/i.test(text);
  if (!isLeave || !mentionsDoctor) return { matched: false, confidence: 0 };

  // Extract doctor name
  const docMatch = text.match(/(?:dr\.?|doctor|physician)\s*([A-Za-z\s.\u0900-\u097F\u0C00-\u0C7F\u0B80-\u0BFF]+?)(?:,|\(|\s+is|\s+on|\s+has|\s+from|\s+will|\n|$)/i);
  const doctorName = docMatch ? `Dr. ${docMatch[1].trim().replace(/^dr\.?\s*/i, '')}` : undefined;

  // Extract date ranges: "from 2026-10-05 to 2026-10-06" or "between 2026-10-05 and 2026-10-06" or "on 2026-10-05"
  const rangeMatch = text.match(/(?:from|between|dates?[:\s]*)\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\s*(?:to|and|until|-)\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/i);
  let leaveStart: string | undefined;
  let leaveEnd: string | undefined;

  if (rangeMatch) {
    leaveStart = rangeMatch[1].trim();
    leaveEnd = rangeMatch[2].trim();
  } else {
    const singleDate = text.match(/(?:on|for|date[:\s]*)\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/i);
    if (singleDate) {
      leaveStart = singleDate[1].trim();
      leaveEnd = singleDate[1].trim();
    }
  }

  // Extract reason
  const reasonMatch = text.match(/(?:due to|reason[:\s]*|because of)\s*([A-Za-z0-9\s.,-]+?)(?:\.|\n|$)/i);
  const reason = reasonMatch ? reasonMatch[1].trim() : 'Emergency Medical Leave';

  const isEmergency = /(?:emergency|hospitalized|acute|critical|urgent|unwell|accident|surgery)/i.test(text);

  // Extract clinic / hospital
  const clinicMatch = text.match(/([A-Za-z0-9\s.,&]+?(?:clinic|hospital|health center|care))/i);
  const clinicOrHospital = clinicMatch ? clinicMatch[1].trim() : undefined;

  if (doctorName && leaveStart && leaveEnd) {
    return {
      matched: true,
      confidence: 0.95,
      data: {
        doctorName,
        leaveStart,
        leaveEnd,
        reason,
        isEmergency,
        clinicOrHospital,
      },
    };
  }

  return { matched: false, confidence: 0 };
}

// ============================================================================
// Multi-Document Dispatcher
// ============================================================================

export function tryDeterministicParse(
  text: string,
  hintedType?: DocumentType
): {
  matched: boolean;
  documentType: DocumentType;
  data?: unknown;
  confidence: number;
} {
  // If hinted, try that parser first
  if (hintedType === 'leave_notice') {
    const res = parseDeterministicDoctorLeave(text);
    if (res.matched) return { matched: true, documentType: 'leave_notice', data: res.data, confidence: res.confidence };
  }
  if (hintedType === 'lab_report') {
    const res = parseDeterministicLabReport(text);
    if (res.matched) return { matched: true, documentType: 'lab_report', data: res.data, confidence: res.confidence };
  }
  if (hintedType === 'prescription') {
    const res = parseDeterministicPrescription(text);
    if (res.matched) return { matched: true, documentType: 'prescription', data: res.data, confidence: res.confidence };
  }
  if (hintedType === 'invoice' || hintedType === 'receipt') {
    const res = parseDeterministicInvoice(text);
    if (res.matched) return { matched: true, documentType: 'invoice', data: res.data, confidence: res.confidence };
  }
  if (hintedType === 'id_card') {
    const res = parseDeterministicIdCard(text);
    if (res.matched) return { matched: true, documentType: 'id_card', data: res.data, confidence: res.confidence };
  }

  // Try in priority order
  const leave = parseDeterministicDoctorLeave(text);
  if (leave.matched && leave.confidence >= 0.85) {
    return { matched: true, documentType: 'leave_notice', data: leave.data, confidence: leave.confidence };
  }

  const lab = parseDeterministicLabReport(text);
  if (lab.matched && lab.confidence >= 0.85) {
    return { matched: true, documentType: 'lab_report', data: lab.data, confidence: lab.confidence };
  }

  const rx = parseDeterministicPrescription(text);
  if (rx.matched && rx.confidence >= 0.85) {
    return { matched: true, documentType: 'prescription', data: rx.data, confidence: rx.confidence };
  }

  const id = parseDeterministicIdCard(text);
  if (id.matched && id.confidence >= 0.85) {
    return { matched: true, documentType: 'id_card', data: id.data, confidence: id.confidence };
  }

  const inv = parseDeterministicInvoice(text);
  if (inv.matched && inv.confidence >= 0.85) {
    return { matched: true, documentType: 'invoice', data: inv.data, confidence: inv.confidence };
  }

  return { matched: false, documentType: hintedType || 'generic', confidence: 0 };
}

