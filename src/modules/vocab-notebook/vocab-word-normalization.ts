export interface NormalizableTraditionalFields {
  simplified: string;
  simplifiedPinyin: string;
  traditional?: string | null;
  traditionalPinyin?: string | null;
}

export interface NormalizedTraditionalFields {
  traditional: string;
  traditionalPinyin: string;
}

/**
 * A blank Traditional Chinese / Traditional Pinyin field means the user
 * considers the Traditional form identical to the Simplified form (a large
 * share of vocabulary — 电影, 东西, 北京, 爸爸, 八, 茶, ... — has no distinct
 * Traditional form worth re-typing). Falls back to the Simplified value;
 * never inferred via AI/lookup, and never overwrites an explicitly different
 * Traditional value.
 *
 * Shared by single-word create/update AND bulk import so both paths behave
 * identically — see VocabNotebookService.
 */
export function normalizeTraditionalFields(input: NormalizableTraditionalFields): NormalizedTraditionalFields {
  return {
    traditional: input.traditional?.trim() || input.simplified.trim(),
    traditionalPinyin: input.traditionalPinyin?.trim() || input.simplifiedPinyin.trim(),
  };
}
