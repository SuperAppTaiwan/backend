// Pure, dependency-free health-profile helpers — deliberately NOT a NestJS
// injectable so any module (including auth, which cannot import ProfileModule
// without creating a circular module dependency) can reuse them directly.
// UserHealthContextService wraps these for DB-aware operations.

import { AllergySeverity, AllergyType, HealthConditionStatus } from './dto/health-profile.dto.js';

export interface Allergy {
  name: string;
  type?: AllergyType;
  severity?: AllergySeverity;
  note?: string;
}

export interface HealthCondition {
  name: string;
  status?: HealthConditionStatus;
  note?: string;
}

export interface Medication {
  name: string;
  dosage?: string;
  frequency?: string;
  note?: string;
}

const MAX_LIST_LENGTH = 50;

function trimAndCap(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function normalizeAllergies(raw: unknown): Allergy[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: Allergy[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = trimAndCap(record.name, 100);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const allergy: Allergy = { name };
    if (Object.values(AllergyType).includes(record.type as AllergyType)) allergy.type = record.type as AllergyType;
    if (Object.values(AllergySeverity).includes(record.severity as AllergySeverity)) allergy.severity = record.severity as AllergySeverity;
    const note = trimAndCap(record.note, 300);
    if (note) allergy.note = note;
    result.push(allergy);
    if (result.length >= MAX_LIST_LENGTH) break;
  }
  return result;
}

export function normalizeHealthConditions(raw: unknown): HealthCondition[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: HealthCondition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = trimAndCap(record.name, 100);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const condition: HealthCondition = { name };
    if (Object.values(HealthConditionStatus).includes(record.status as HealthConditionStatus)) condition.status = record.status as HealthConditionStatus;
    const note = trimAndCap(record.note, 300);
    if (note) condition.note = note;
    result.push(condition);
    if (result.length >= MAX_LIST_LENGTH) break;
  }
  return result;
}

export function normalizeMedications(raw: unknown): Medication[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: Medication[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = trimAndCap(record.name, 150);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const medication: Medication = { name };
    const dosage = trimAndCap(record.dosage, 100);
    if (dosage) medication.dosage = dosage;
    const frequency = trimAndCap(record.frequency, 100);
    if (frequency) medication.frequency = frequency;
    const note = trimAndCap(record.note, 300);
    if (note) medication.note = note;
    result.push(medication);
    if (result.length >= MAX_LIST_LENGTH) break;
  }
  return result;
}

// BMI is always derived from weight/height rather than stored, so it can
// never drift out of sync — see the schema comment on UserProfile.
export function calculateBmi(weightKg: number | null, heightCm: number | null): { bmi: number | null; bmiCategory: string | null } {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) {
    return { bmi: null, bmiCategory: null };
  }
  const heightM = heightCm / 100;
  const bmi = Math.round((weightKg / (heightM * heightM)) * 10) / 10;

  // Taiwan Health Promotion Administration adult BMI thresholds (more
  // appropriate for this app's Taiwan-based user base than WHO's general
  // cutoffs). This is a general-population reference range, not a diagnosis.
  let bmiCategory: string;
  if (bmi < 18.5) bmiCategory = 'Thiếu cân';
  else if (bmi < 24) bmiCategory = 'Bình thường';
  else if (bmi < 27) bmiCategory = 'Thừa cân';
  else if (bmi < 30) bmiCategory = 'Béo phì độ I';
  else bmiCategory = 'Béo phì độ II';

  return { bmi, bmiCategory };
}
