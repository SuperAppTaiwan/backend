import type { AIHealthContext } from '../../profile/user-health-context.service.js';

// Maintainable "policy layer" translating a health condition name into a
// general soft-optimization cooking guideline. Deliberately generic and
// non-prescriptive — this is meal-planning guidance, not medical treatment
// advice, and unrecognized conditions still get a safe generic fallback.
const CONDITION_GUIDANCE: Array<{ match: RegExp; guidance: string }> = [
  { match: /tiểu đường|diabet/i, guidance: 'ưu tiên thực phẩm có chỉ số đường huyết thấp, hạn chế đường và tinh bột hấp thu nhanh' },
  { match: /cao huyết áp|hypertension|huyết áp/i, guidance: 'hạn chế muối/natri, tránh thực phẩm chế biến sẵn nhiều muối' },
  { match: /mỡ máu|cholesterol/i, guidance: 'hạn chế chất béo bão hòa và nội tạng động vật, ưu tiên chất béo không bão hòa' },
  { match: /gout/i, guidance: 'hạn chế thực phẩm giàu purin (nội tạng, hải sản, thịt đỏ), hạn chế bia rượu' },
  { match: /thận|kidney/i, guidance: 'cân nhắc lượng đạm, kali và photpho vừa phải; hạn chế muối' },
  { match: /gan nhiễm mỡ|fatty liver/i, guidance: 'hạn chế chất béo bão hòa và đường tinh luyện' },
  { match: /dạ dày|gastritis|trào ngược|reflux/i, guidance: 'tránh đồ cay, chua, nhiều dầu mỡ; ưu tiên món hấp/luộc, dễ tiêu' },
  { match: /tim mạch|cardiovascular/i, guidance: 'hạn chế muối và chất béo bão hòa, ưu tiên cá và rau củ' },
];

function guidanceForCondition(name: string): string {
  const found = CONDITION_GUIDANCE.find((c) => c.match.test(name));
  return found ? found.guidance : 'cân nhắc phù hợp với tình trạng sức khỏe này, tránh các món có thể gây khó chịu';
}

function buildSoftGoals(context: AIHealthContext): string[] {
  const goals: string[] = [];
  for (const condition of context.healthConditions) {
    goals.push(`- ${condition.name}: ${guidanceForCondition(condition.name)}`);
  }
  if (context.bmiCategory === 'Thừa cân' || context.bmiCategory === 'Béo phì độ I' || context.bmiCategory === 'Béo phì độ II') {
    goals.push('- BMI cho thấy thừa cân: ưu tiên khẩu phần vừa phải, ít calo rỗng, nhiều rau xanh');
  } else if (context.bmiCategory === 'Thiếu cân') {
    goals.push('- BMI cho thấy thiếu cân: có thể tăng khẩu phần và mật độ calo hợp lý');
  }
  return goals;
}

function buildMedicationNote(context: AIHealthContext): string {
  if (context.medications.length === 0) return '';
  const names = context.medications.map((m) => (m.frequency ? `${m.name} (${m.frequency})` : m.name)).join(', ');
  return `\nTHUỐC ĐANG DÙNG (chỉ mang tính tham khảo bối cảnh — KHÔNG đưa ra tuyên bố về tương tác thuốc, không thay thế tư vấn dược sĩ/bác sĩ): ${names}`;
}

// Shared "hard constraints / soft goals / medication context" block used by
// both the recipe-batch prompt and the single-meal-slot prompt, so the two
// generation paths can never silently drift apart on health policy.
function buildHealthBlock(context: AIHealthContext, dietPreference: string | null | undefined, forbiddenAllergens: string[]): string {
  const hardConstraints: string[] = [];
  if (forbiddenAllergens.length > 0) {
    hardConstraints.push(`- DỊ ỨNG/CẤM TUYỆT ĐỐI — KHÔNG được xuất hiện dưới bất kỳ hình thức nào (kể cả trong nước chấm, gia vị): ${forbiddenAllergens.join(', ')}`);
  }
  if (dietPreference) {
    hardConstraints.push(`- Chế độ ăn bắt buộc: ${dietPreference}`);
  }

  const softGoals = buildSoftGoals(context);
  const medicationNote = buildMedicationNote(context);

  return `
${hardConstraints.length > 0 ? `RÀNG BUỘC BẮT BUỘC (HARD CONSTRAINTS — vi phạm là không chấp nhận được):\n${hardConstraints.join('\n')}\n` : ''}
${softGoals.length > 0 ? `MỤC TIÊU TỐI ƯU SỨC KHỎE (cố gắng đáp ứng nhưng không bắt buộc tuyệt đối):\n${softGoals.join('\n')}\n` : ''}${medicationNote}
`.trim();
}

function buildCorrectionBlock(correctionNotice: string | undefined): string {
  return correctionNotice
    ? `\n⚠️ LƯU Ý QUAN TRỌNG: Lần tạo trước đó VI PHẠM ràng buộc dị ứng (${correctionNotice}). Hãy tạo lại và tuyệt đối tránh các thành phần đó.\n`
    : '';
}

export interface HealthAwareRecipePromptParams {
  userHealthContext: AIHealthContext;
  dietPreference?: string | null;
  ingredientList: Array<{ name: string; category: string; quantity?: number; unit?: string; expiresAt: string | null; isExpiringSoon: boolean }>;
  hasInventory: boolean;
  count: number;
  forbiddenAllergens: string[];
  responseSchema: string;
  /** Set on a retry after the previous AI response failed allergen validation. */
  correctionNotice?: string;
}

export function buildHealthAwareRecipePrompt(params: HealthAwareRecipePromptParams): string {
  const { userHealthContext, dietPreference, ingredientList, hasInventory, count, forbiddenAllergens, responseSchema, correctionNotice } = params;

  const healthBlock = buildHealthBlock(userHealthContext, dietPreference, forbiddenAllergens);
  const correctionBlock = buildCorrectionBlock(correctionNotice);

  const intro = hasInventory
    ? `You are a Vietnamese home cooking AI assistant. Generate ${count} practical recipe suggestions that prioritize using the ingredients the user already has, to maximize ingredient usage and minimize food waste.

Available ingredients:
${JSON.stringify(ingredientList, null, 2)}

PRIORITY: Use ingredients marked as isExpiringSoon=true first. It's fine for a recipe to need a few extra ingredients the user doesn't have — list those honestly in missingIngredients rather than refusing to suggest the recipe.`
    : `You are a Vietnamese home cooking AI assistant. The user has no ingredients logged in their inventory yet. Generate ${count} popular, practical Vietnamese home-cooking recipes that most households can make with common pantry staples.`;

  return `${intro}
${correctionBlock}
${healthBlock}

Return a JSON array of ${count} recipes:
${responseSchema}

Rules:
- Every recipe MUST respect the hard constraints above with no exceptions
- Use Vietnamese for descriptions and instructions
- Keep instructions practical and specific
- Fill healthSuitability honestly: list which health conditions this recipe suits, which allergens were deliberately avoided, and add a short plain-language explanation
- If a hard constraint made a popular dish impossible, substitute a safe alternative rather than ignoring the constraint`;
}

export interface HealthAwareMealPromptParams {
  userHealthContext: AIHealthContext;
  dietPreference?: string | null;
  mealTypeLabel: string;
  planDate: string;
  mealTypeConstraints: string;
  busyLine: string;
  weeklyNutritionContext: string;
  ingredientList: Array<{ name: string; category: string; expiresAt: string | null }>;
  hardExcluded: string[];
  weekMealNames: string[];
  forbiddenAllergens: string[];
  responseSchema: string;
  correctionNotice?: string;
}

export function buildHealthAwareMealPrompt(params: HealthAwareMealPromptParams): string {
  const {
    userHealthContext, dietPreference, mealTypeLabel, planDate, mealTypeConstraints, busyLine,
    weeklyNutritionContext, ingredientList, hardExcluded, weekMealNames, forbiddenAllergens,
    responseSchema, correctionNotice,
  } = params;

  const healthBlock = buildHealthBlock(userHealthContext, dietPreference, forbiddenAllergens);
  const correctionBlock = buildCorrectionBlock(correctionNotice);

  return `You are a Vietnamese nutritionist and chef AI. Suggest ONE ${mealTypeLabel} meal for ${planDate}.
${correctionBlock}
MEAL TYPE RULES:
${mealTypeConstraints}

SCHEDULE:
${busyLine}

WEEKLY NUTRITION BALANCE:
${weeklyNutritionContext}

${healthBlock}

AVAILABLE INGREDIENTS (prioritise expiring first):
${JSON.stringify(ingredientList)}

FORBIDDEN — already in this slot or rejected. MUST NOT appear in your suggestion:
${hardExcluded.length ? hardExcluded.join(', ') : 'none'}

Other meals this week (try to avoid repeating):
${weekMealNames.join(', ') || 'none'}

Return ONE JSON object — no markdown, no explanation:
${responseSchema}`;
}
