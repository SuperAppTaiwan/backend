import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AllergySeverity, HealthConditionStatus } from './dto/health-profile.dto.js';
import {
  calculateBmi,
  normalizeAllergies,
  normalizeHealthConditions,
  normalizeMedications,
  type Allergy,
  type HealthCondition,
  type Medication,
} from './health-profile.util.js';

export type { Allergy, HealthCondition, Medication };

export interface HealthProfileSnapshot {
  weightKg: number | null;
  heightCm: number | null;
  bmi: number | null;
  bmiCategory: string | null;
  allergies: Allergy[];
  healthConditions: HealthCondition[];
  medications: Medication[];
}

// Minimal, AI-ready projection of the health profile — no user identity (name,
// email, phone) is ever included, per the privacy requirement to send only
// what a recommendation needs to the external AI provider.
export interface AIHealthContext {
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  bmiCategory: string | null;
  allergies: Array<{ name: string; severity?: AllergySeverity }>;
  healthConditions: Array<{ name: string; status?: HealthConditionStatus }>;
  medications: Array<{ name: string; frequency?: string }>;
  hasCompleteProfile: boolean;
}

// Curated aliases for the allergens called out explicitly in the product spec.
// This is a best-effort deterministic safety net, not exhaustive allergen
// detection — see the disclaimer surfaced alongside AI-generated recipes.
const ALLERGEN_ALIASES: Record<string, string[]> = {
  peanut: ['peanut', 'peanuts', 'groundnut', 'groundnuts', 'peanut butter', 'peanut oil', 'đậu phộng', 'lạc'],
  shrimp: ['shrimp', 'shrimps', 'prawn', 'prawns', 'tôm'],
  shellfish: ['shellfish', 'crab', 'lobster', 'oyster', 'clam', 'mussel', 'scallop', 'hải sản có vỏ', 'cua', 'sò', 'ốc', 'nghêu'],
  milk: ['milk', 'dairy', 'lactose', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'sữa', 'phô mai', 'bơ', 'kem sữa'],
  egg: ['egg', 'eggs', 'trứng'],
  soy: ['soy', 'soya', 'soybean', 'soybeans', 'tofu', 'đậu nành', 'đậu phụ'],
  gluten: ['gluten', 'wheat', 'barley', 'rye', 'lúa mì', 'bột mì'],
  fish: ['fish', 'cá', 'nước mắm', 'fish sauce'],
  beef: ['beef', 'thịt bò'],
};

@Injectable()
export class UserHealthContextService {
  constructor(private readonly prisma: PrismaService) {}

  normalizeAllergies(raw: unknown): Allergy[] {
    return normalizeAllergies(raw);
  }

  normalizeHealthConditions(raw: unknown): HealthCondition[] {
    return normalizeHealthConditions(raw);
  }

  normalizeMedications(raw: unknown): Medication[] {
    return normalizeMedications(raw);
  }

  calculateBmi(weightKg: number | null, heightCm: number | null): { bmi: number | null; bmiCategory: string | null } {
    return calculateBmi(weightKg, heightCm);
  }

  async getHealthProfile(userId: string): Promise<HealthProfileSnapshot> {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    const weightKg = profile?.weightKg ?? null;
    const heightCm = profile?.heightCm ?? null;
    const { bmi, bmiCategory } = calculateBmi(weightKg, heightCm);

    return {
      weightKg,
      heightCm,
      bmi,
      bmiCategory,
      allergies: normalizeAllergies(profile?.allergies),
      healthConditions: normalizeHealthConditions(profile?.healthConditions),
      medications: normalizeMedications(profile?.medications),
    };
  }

  // Reusable by recipe generation, meal planning, nutrition analysis, and
  // shopping-list generation — anything that calls an AI provider should go
  // through this rather than reading UserProfile directly, so PII stays out
  // of prompts consistently.
  async buildAIHealthContext(userId: string): Promise<AIHealthContext> {
    const snapshot = await this.getHealthProfile(userId);
    const hasCompleteProfile = snapshot.weightKg !== null && snapshot.heightCm !== null;

    return {
      heightCm: snapshot.heightCm,
      weightKg: snapshot.weightKg,
      bmi: snapshot.bmi,
      bmiCategory: snapshot.bmiCategory,
      allergies: snapshot.allergies.map((a) => ({ name: a.name, severity: a.severity })),
      healthConditions: snapshot.healthConditions.map((c) => ({ name: c.name, status: c.status })),
      medications: snapshot.medications.map((m) => ({ name: m.name, frequency: m.frequency })),
      hasCompleteProfile,
    };
  }

  hasSevereAllergy(context: Pick<AIHealthContext, 'allergies'>): boolean {
    return context.allergies.some((a) => a.severity === AllergySeverity.SEVERE);
  }

  // Deterministic forbidden-term list: each allergy name plus any known
  // aliases/derivatives (e.g. "peanuts" -> peanut butter, peanut oil, groundnut),
  // merged with any explicit exclusions the caller passes in. Used both to
  // steer the AI prompt and to validate its output afterwards.
  buildForbiddenAllergenList(allergies: Array<{ name: string }>, explicitExclusions: string[] = []): string[] {
    const terms = new Set<string>();
    for (const allergy of allergies) {
      const normalized = allergy.name.trim().toLowerCase();
      if (!normalized) continue;
      terms.add(normalized);
      for (const aliasGroup of Object.values(ALLERGEN_ALIASES)) {
        if (aliasGroup.some((alias) => normalized.includes(alias) || alias.includes(normalized))) {
          aliasGroup.forEach((alias) => terms.add(alias));
        }
      }
    }
    for (const exclusion of explicitExclusions) {
      const normalized = exclusion.trim().toLowerCase();
      if (normalized) terms.add(normalized);
    }
    return [...terms];
  }

  // Scans free text (title/description/steps) plus ingredient names for any
  // forbidden term. Substring matching is intentionally broad (better a false
  // positive that triggers a retry than a missed allergen) — see the recipe
  // disclaimer for the corresponding limitation.
  findAllergenMatches(text: string, forbiddenTerms: string[]): string[] {
    const haystack = text.toLowerCase();
    return forbiddenTerms.filter((term) => term.length > 1 && haystack.includes(term));
  }

  checkRecipeForAllergens(
    recipe: { title?: string; description?: string; ingredientsJson?: unknown },
    forbiddenTerms: string[],
  ): { safe: boolean; matchedAllergens: string[] } {
    if (forbiddenTerms.length === 0) return { safe: true, matchedAllergens: [] };

    const ingredientNames = Array.isArray(recipe.ingredientsJson)
      ? (recipe.ingredientsJson as Array<{ name?: unknown }>).map((i) => (typeof i?.name === 'string' ? i.name : '')).join(' ; ')
      : '';
    const haystack = [recipe.title ?? '', recipe.description ?? '', ingredientNames].join(' ; ');

    const matched = [...new Set(this.findAllergenMatches(haystack, forbiddenTerms))];
    return { safe: matched.length === 0, matchedAllergens: matched };
  }
}
