import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { UserHealthContextService } from './user-health-context.service.js';
import { AllergySeverity } from './dto/health-profile.dto.js';

describe('UserHealthContextService', () => {
  let service: UserHealthContextService;
  let prisma: { userProfile: { findUnique: jest.Mock } };

  beforeEach(async () => {
    const mockPrisma = { userProfile: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UserHealthContextService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(UserHealthContextService);
    prisma = module.get(PrismaService);
  });

  describe('normalizeAllergies', () => {
    it('trims names, drops empty entries, and deduplicates case-insensitively (keeping the first match)', () => {
      const result = service.normalizeAllergies([
        { name: '  Đậu phộng  ', severity: 'severe' },
        { name: 'đậu phộng', severity: 'mild' }, // duplicate, case-insensitive — should be dropped
        { name: '   ' }, // empty after trim — dropped
        { name: 'Tôm', type: 'ingredient' },
      ]);

      expect(result).toEqual([
        { name: 'Đậu phộng', severity: 'severe' },
        { name: 'Tôm', type: 'ingredient' },
      ]);
    });

    it('returns an empty array for non-array or malformed input', () => {
      expect(service.normalizeAllergies(undefined)).toEqual([]);
      expect(service.normalizeAllergies(null)).toEqual([]);
      expect(service.normalizeAllergies('not an array')).toEqual([]);
      expect(service.normalizeAllergies([{ noName: true }, 'not an object', null])).toEqual([]);
    });

    it('drops unrecognized enum values rather than persisting garbage', () => {
      const result = service.normalizeAllergies([{ name: 'Sữa', severity: 'catastrophic', type: 'invalid' }]);
      expect(result).toEqual([{ name: 'Sữa' }]);
    });
  });

  describe('normalizeHealthConditions / normalizeMedications', () => {
    it('normalizes health conditions the same way', () => {
      const result = service.normalizeHealthConditions([
        { name: ' Tiểu đường ', status: 'active' },
        { name: 'tiểu đường' }, // duplicate
      ]);
      expect(result).toEqual([{ name: 'Tiểu đường', status: 'active' }]);
    });

    it('normalizes medications, keeping optional dosage/frequency/note', () => {
      const result = service.normalizeMedications([
        { name: 'Metformin', dosage: '500mg', frequency: 'once daily', note: 'after breakfast' },
      ]);
      expect(result).toEqual([{ name: 'Metformin', dosage: '500mg', frequency: 'once daily', note: 'after breakfast' }]);
    });
  });

  describe('calculateBmi', () => {
    it('calculates BMI and category correctly for a normal-range adult', () => {
      const { bmi, bmiCategory } = service.calculateBmi(65, 172);
      expect(bmi).toBeCloseTo(21.97, 1);
      expect(bmiCategory).toBe('Bình thường');
    });

    it('categorizes overweight/obese correctly using Taiwan HPA thresholds', () => {
      expect(service.calculateBmi(72, 170).bmiCategory).toBe('Thừa cân'); // bmi ≈ 24.9
      expect(service.calculateBmi(80, 170).bmiCategory).toBe('Béo phì độ I'); // bmi ≈ 27.7
      expect(service.calculateBmi(90, 170).bmiCategory).toBe('Béo phì độ II'); // bmi ≈ 31.1
    });

    it('categorizes underweight correctly', () => {
      expect(service.calculateBmi(45, 172).bmiCategory).toBe('Thiếu cân');
    });

    it('returns null for missing or invalid inputs rather than throwing', () => {
      expect(service.calculateBmi(null, 172)).toEqual({ bmi: null, bmiCategory: null });
      expect(service.calculateBmi(65, null)).toEqual({ bmi: null, bmiCategory: null });
      expect(service.calculateBmi(0, 172)).toEqual({ bmi: null, bmiCategory: null });
      expect(service.calculateBmi(-5, 172)).toEqual({ bmi: null, bmiCategory: null });
    });
  });

  describe('hasSevereAllergy', () => {
    it('returns true when any allergy is severity=severe', () => {
      expect(service.hasSevereAllergy({ allergies: [{ name: 'Tôm', severity: AllergySeverity.MILD }, { name: 'Đậu phộng', severity: AllergySeverity.SEVERE }] })).toBe(true);
    });
    it('returns false when no allergy is severe', () => {
      expect(service.hasSevereAllergy({ allergies: [{ name: 'Tôm', severity: AllergySeverity.MILD }] })).toBe(false);
      expect(service.hasSevereAllergy({ allergies: [] })).toBe(false);
    });
  });

  describe('buildForbiddenAllergenList', () => {
    it('expands a known allergen into its curated aliases/derivatives', () => {
      const terms = service.buildForbiddenAllergenList([{ name: 'Đậu phộng' }]);
      expect(terms).toEqual(expect.arrayContaining(['đậu phộng', 'peanut', 'peanuts', 'peanut butter', 'peanut oil', 'groundnut']));
    });

    it('includes a custom/unrecognized allergy name verbatim without inventing aliases', () => {
      const terms = service.buildForbiddenAllergenList([{ name: 'Sầu riêng' }]);
      expect(terms).toContain('sầu riêng');
      expect(terms.length).toBe(1);
    });

    it('merges in explicit exclusions passed by the caller', () => {
      const terms = service.buildForbiddenAllergenList([], ['MSG', 'Cilantro']);
      expect(terms).toEqual(expect.arrayContaining(['msg', 'cilantro']));
    });
  });

  describe('findAllergenMatches / checkRecipeForAllergens', () => {
    it('finds a case-insensitive substring match in free text', () => {
      expect(service.findAllergenMatches('Món xào Đậu Phộng Rang', ['đậu phộng'])).toEqual(['đậu phộng']);
    });

    it('checkRecipeForAllergens is safe when no forbidden terms are configured', () => {
      expect(service.checkRecipeForAllergens({ title: 'Anything' }, [])).toEqual({ safe: true, matchedAllergens: [] });
    });

    it('checkRecipeForAllergens flags a match in the title', () => {
      const result = service.checkRecipeForAllergens({ title: 'Tôm rang muối', ingredientsJson: [] }, ['tôm']);
      expect(result.safe).toBe(false);
      expect(result.matchedAllergens).toContain('tôm');
    });

    it('checkRecipeForAllergens flags a match hidden inside an ingredient name', () => {
      const result = service.checkRecipeForAllergens(
        { title: 'Cơm chiên', ingredientsJson: [{ name: 'Nước mắm' }, { name: 'Tôm khô' }] },
        ['tôm'],
      );
      expect(result.safe).toBe(false);
      expect(result.matchedAllergens).toContain('tôm');
    });

    it('checkRecipeForAllergens passes a genuinely safe recipe', () => {
      const result = service.checkRecipeForAllergens(
        { title: 'Canh rau củ', description: 'Rau củ luộc', ingredientsJson: [{ name: 'Cà rốt' }, { name: 'Bí đỏ' }] },
        ['tôm', 'đậu phộng'],
      );
      expect(result).toEqual({ safe: true, matchedAllergens: [] });
    });
  });

  describe('buildAIHealthContext', () => {
    it('never includes user identity fields (email, name, phone) — only health data', async () => {
      prisma.userProfile.findUnique.mockResolvedValue({
        weightKg: 65, heightCm: 172,
        allergies: [{ name: 'Tôm', severity: 'severe' }],
        healthConditions: [{ name: 'Hypertension', status: 'active' }],
        medications: [{ name: 'Lisinopril', frequency: 'daily' }],
      });

      const context = await service.buildAIHealthContext('user-1');

      expect(Object.keys(context).sort()).toEqual(
        ['allergies', 'bmi', 'bmiCategory', 'hasCompleteProfile', 'healthConditions', 'heightCm', 'medications', 'weightKg'].sort(),
      );
      expect(JSON.stringify(context)).not.toMatch(/@|email|phone/i);
    });

    it('hasCompleteProfile is false when weight or height is missing', async () => {
      prisma.userProfile.findUnique.mockResolvedValue({ weightKg: null, heightCm: 172, allergies: [], healthConditions: [], medications: [] });
      const context = await service.buildAIHealthContext('user-1');
      expect(context.hasCompleteProfile).toBe(false);
    });

    it('returns a safe empty context when the profile does not exist', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);
      const context = await service.buildAIHealthContext('user-1');
      expect(context.allergies).toEqual([]);
      expect(context.hasCompleteProfile).toBe(false);
    });
  });
});
