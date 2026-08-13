import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { AIProviderChain } from '../ai/providers/ai-provider-chain.service.js';
import { selectReviewWords, type SelectableWord } from '../vocab-notebook/review-selection.js';
import { SaveStoryDto } from './dto/story.dto.js';

export interface StoryParagraph {
  simplified: string;
  traditional: string;
  vietnamese: string;
}

export interface StoryVocabularyUsed {
  simplified: string;
  traditional: string | null;
  pinyin: string | null;
  meaningVi: string | null;
}

export interface StoryPreview {
  titleSimplified: string;
  titleTraditional: string;
  paragraphs: StoryParagraph[];
  vocabularyUsed: StoryVocabularyUsed[];
  wordCount: number;
  estimatedReadMinutes: number;
  provider: string;
}

interface CandidateWord {
  simplified: string;
  traditional: string;
  pinyin: string;
  meaningVi: string;
}

const MIN_VOCAB_WORDS = 3;
const MAX_VOCAB_WORDS = 10;
// Rough Chinese reading speed for learner-paced text, used only for the reader's
// estimated-minutes badge — not a scientific figure.
const CHARS_PER_MINUTE = 150;

// Beginner-friendly common vocabulary used to supplement/replace the user's own
// notebook when it's empty or too small to build a coherent story from — story
// generation must never be blocked by an empty vocabulary library (spec §4).
const FALLBACK_VOCAB: CandidateWord[] = [
  { simplified: '你好', traditional: '你好', pinyin: 'nǐ hǎo', meaningVi: 'xin chào' },
  { simplified: '谢谢', traditional: '謝謝', pinyin: 'xiè xiè', meaningVi: 'cảm ơn' },
  { simplified: '朋友', traditional: '朋友', pinyin: 'péng yǒu', meaningVi: 'bạn bè' },
  { simplified: '今天', traditional: '今天', pinyin: 'jīn tiān', meaningVi: 'hôm nay' },
  { simplified: '天气', traditional: '天氣', pinyin: 'tiān qì', meaningVi: 'thời tiết' },
  { simplified: '工作', traditional: '工作', pinyin: 'gōng zuò', meaningVi: 'công việc' },
  { simplified: '学习', traditional: '學習', pinyin: 'xué xí', meaningVi: 'học tập' },
  { simplified: '吃饭', traditional: '吃飯', pinyin: 'chī fàn', meaningVi: 'ăn cơm' },
  { simplified: '喜欢', traditional: '喜歡', pinyin: 'xǐ huān', meaningVi: 'thích' },
  { simplified: '台湾', traditional: '台灣', pinyin: 'tái wān', meaningVi: 'Đài Loan' },
];

@Injectable()
export class ChineseStoryService {
  private readonly logger = new Logger(ChineseStoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly aiChain: AIProviderChain,
  ) {}

  // ─── Saved stories ───────────────────────────────────────────────────────

  async listStories(userId: string) {
    return this.prisma.story.findMany({
      where: { userId },
      select: {
        id: true,
        titleSimplified: true,
        titleTraditional: true,
        wordCount: true,
        estimatedReadMinutes: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStory(userId: string, id: string) {
    const story = await this.prisma.story.findFirst({ where: { id, userId } });
    if (!story) throw new NotFoundException('Story not found');
    return story;
  }

  async deleteStory(userId: string, id: string) {
    const story = await this.prisma.story.findFirst({ where: { id, userId } });
    if (!story) throw new NotFoundException('Story not found');

    await this.prisma.story.delete({ where: { id } });
    await this.events.publish({
      userId,
      eventType: EventType.STORY_DELETED,
      sourceModule: 'chinese-story',
      payload: { storyId: id },
    });
    return { message: 'Story deleted' };
  }

  async saveStory(userId: string, dto: SaveStoryDto) {
    // Re-derive word count / read time server-side rather than trusting whatever
    // the client echoes back from the preview it was shown.
    const paragraphs: StoryParagraph[] = dto.paragraphs.map((p) => ({
      simplified: p.simplified,
      traditional: p.traditional,
      vietnamese: p.vietnamese,
    }));
    const wordCount = this.countHanzi(paragraphs.map((p) => p.simplified).join(''));
    const estimatedReadMinutes = Math.max(1, Math.round(wordCount / CHARS_PER_MINUTE));

    const story = await this.prisma.story.create({
      data: {
        userId,
        titleSimplified: dto.titleSimplified,
        titleTraditional: dto.titleTraditional,
        paragraphsJson: paragraphs as unknown as Prisma.InputJsonValue,
        vocabularyUsedJson: (dto.vocabularyUsed ?? []) as unknown as Prisma.InputJsonValue,
        wordCount,
        estimatedReadMinutes,
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.STORY_SAVED,
      sourceModule: 'chinese-story',
      payload: { storyId: story.id, wordCount },
    });
    return story;
  }

  // ─── Generate (preview only — nothing is written to the database here) ────

  async generatePreview(userId: string): Promise<StoryPreview> {
    const { candidateWords, usingFallback } = await this.pickVocabulary(userId);
    const prompt = this.buildPrompt(candidateWords, usingFallback);

    let raw = '';
    try {
      raw = await this.aiChain.generateText(prompt);
    } catch (err) {
      this.logger.warn('AI story generation failed, using deterministic fallback', err as Error);
    }

    // Never trust malformed/absent model output blindly — fall back to a
    // deterministic template that always produces a valid story, same
    // "AI-optional" guarantee the rest of the app follows (CLAUDE.md rule 15).
    const parsed = raw ? this.parseAndValidate(raw) : null;
    const draft = parsed ?? this.deterministicStory(candidateWords);
    const provider = parsed ? 'ai' : 'deterministic';

    // Recompute which vocabulary actually appears in the generated text rather
    // than trusting an AI self-report — this is also what drives the reader's
    // vocab highlighting (spec §9), so it must reflect real matches.
    const vocabularyUsed = this.matchVocabularyUsed(draft.paragraphs, candidateWords);
    const wordCount = this.countHanzi(draft.paragraphs.map((p) => p.simplified).join(''));
    const estimatedReadMinutes = Math.max(1, Math.round(wordCount / CHARS_PER_MINUTE));

    await this.events.publish({
      userId,
      eventType: EventType.STORY_GENERATED,
      sourceModule: 'chinese-story',
      payload: {
        provider,
        vocabularyOffered: candidateWords.length,
        vocabularyUsed: vocabularyUsed.length,
        usingFallbackVocab: usingFallback,
      },
    });

    return { ...draft, vocabularyUsed, wordCount, estimatedReadMinutes, provider };
  }

  // ─── Vocabulary selection ──────────────────────────────────────────────────

  private async pickVocabulary(
    userId: string,
  ): Promise<{ candidateWords: CandidateWord[]; usingFallback: boolean }> {
    const words = await this.prisma.vocabWord.findMany({
      where: { userId },
      include: { progress: true },
    });

    if (words.length === 0) {
      return { candidateWords: this.shuffle(FALLBACK_VOCAB).slice(0, MAX_VOCAB_WORDS), usingFallback: true };
    }

    // Reuse the notebook's own review-priority ordering (never-reviewed first,
    // then due/stale, then recently-reviewed — see review-selection.ts) instead
    // of building a second selection algorithm for the same underlying data.
    const selectable: SelectableWord[] = words.map((w) => ({
      id: w.id,
      createdAt: w.createdAt,
      progress: w.progress
        ? {
            status: w.progress.status,
            nextReviewAt: w.progress.nextReviewAt,
            lastReviewedAt: w.progress.lastReviewedAt,
            lastReviewSessionId: w.progress.lastReviewSessionId,
          }
        : null,
    }));
    const count = Math.min(MAX_VOCAB_WORDS, words.length);
    const orderedIds = selectReviewWords(selectable, count).map((w) => w.id);
    const byId = new Map(words.map((w) => [w.id, w]));

    let picked: CandidateWord[] = orderedIds
      .map((id) => byId.get(id))
      .filter((w): w is NonNullable<typeof w> => !!w)
      .map((w) => ({
        simplified: w.simplified,
        traditional: w.traditional ?? w.simplified,
        pinyin: w.simplifiedPinyin,
        meaningVi: w.meaningVi,
      }));

    // Too few of the user's own words to build a coherent story — top up with
    // common fallback vocabulary rather than blocking generation (spec §4).
    if (picked.length < MIN_VOCAB_WORDS) {
      const need = MIN_VOCAB_WORDS - picked.length;
      const ownSimplified = new Set(picked.map((w) => w.simplified));
      const filler = this.shuffle(FALLBACK_VOCAB)
        .filter((w) => !ownSimplified.has(w.simplified))
        .slice(0, need);
      picked = [...picked, ...filler];
    }

    return { candidateWords: picked, usingFallback: false };
  }

  private shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // ─── Prompting / parsing ───────────────────────────────────────────────────

  private buildPrompt(words: CandidateWord[], usingFallback: boolean): string {
    const vocabList = words.map((w) => `${w.simplified} (${w.pinyin} - ${w.meaningVi})`).join(', ');
    return [
      'Bạn là giáo viên tiếng Trung viết truyện ngắn cho người Việt học tiếng Trung ở trình độ sơ - trung cấp (khoảng HSK 1-3).',
      usingFallback
        ? 'Người học chưa có từ vựng riêng — hãy dùng danh sách từ vựng phổ biến sau:'
        : 'Hãy cố gắng lồng ghép một cách TỰ NHIÊN một số từ vựng sau vào câu chuyện (không bắt buộc dùng hết, không liệt kê khiên cưỡng):',
      vocabList,
      '',
      'Yêu cầu:',
      '- Câu chuyện đơn giản, mạch lạc, tình huống đời thường (đi làm, gặp bạn bè, ăn uống, thời tiết, đi chơi, ...).',
      '- Câu ngắn, dễ hiểu, tránh từ Hán cổ / văn học phức tạp.',
      '- 4 đến 7 đoạn (paragraphs), mỗi đoạn khoảng 1-2 câu.',
      '- Cung cấp cả bản giản thể và phồn thể cho tiêu đề và từng đoạn, cùng bản dịch tiếng Việt sát nghĩa cho từng đoạn.',
      '',
      'CHỈ trả lời bằng JSON hợp lệ theo đúng định dạng sau, không thêm bất kỳ văn bản nào khác trước hoặc sau JSON:',
      '{"titleSimplified": "...", "titleTraditional": "...", "paragraphs": [{"simplified": "...", "traditional": "...", "vietnamese": "..."}]}',
    ].join('\n');
  }

  private parseAndValidate(
    text: string,
  ): { titleSimplified: string; titleTraditional: string; paragraphs: StoryParagraph[] } | null {
    try {
      const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const obj = JSON.parse(match[0]) as Record<string, unknown>;

      if (typeof obj.titleSimplified !== 'string' || !obj.titleSimplified.trim()) return null;
      if (typeof obj.titleTraditional !== 'string' || !obj.titleTraditional.trim()) return null;
      if (!Array.isArray(obj.paragraphs) || obj.paragraphs.length === 0) return null;

      const paragraphs: StoryParagraph[] = [];
      for (const p of obj.paragraphs as unknown[]) {
        if (typeof p !== 'object' || p === null) continue;
        const rec = p as Record<string, unknown>;
        if (typeof rec.simplified !== 'string' || typeof rec.vietnamese !== 'string') continue;
        if (!rec.simplified.trim() || !rec.vietnamese.trim()) continue;
        const traditional = typeof rec.traditional === 'string' && rec.traditional.trim()
          ? rec.traditional.trim()
          : rec.simplified.trim();
        paragraphs.push({ simplified: rec.simplified.trim(), traditional, vietnamese: rec.vietnamese.trim() });
      }
      if (paragraphs.length === 0) return null;

      return {
        titleSimplified: obj.titleSimplified.trim(),
        titleTraditional: obj.titleTraditional.trim(),
        paragraphs,
      };
    } catch {
      return null;
    }
  }

  // ─── Deterministic fallback (no AI key / provider failure / malformed output) ──

  private deterministicStory(
    words: CandidateWord[],
  ): { titleSimplified: string; titleTraditional: string; paragraphs: StoryParagraph[] } {
    // Fixed template filled in with the offered words — always produces a valid,
    // readable (if simple) story with zero AI dependency, so generation never
    // fails just because no AI key is configured (CLAUDE.md rule 15).
    const pool = words.length > 0 ? words : FALLBACK_VOCAB;
    const pick = (i: number) => pool[i % pool.length];
    const w0 = pick(0);
    const w1 = pick(1);
    const w2 = pick(2);

    const paragraphs: StoryParagraph[] = [
      { simplified: '今天天气很好。', traditional: '今天天氣很好。', vietnamese: 'Hôm nay thời tiết rất đẹp.' },
      {
        simplified: `我和朋友一起聊到了${w0.simplified}。`,
        traditional: `我和朋友一起聊到了${w0.traditional}。`,
        vietnamese: `Tôi cùng bạn bè nói chuyện về ${w0.meaningVi}.`,
      },
      {
        simplified: `我们都很喜欢${w1.simplified}。`,
        traditional: `我們都很喜歡${w1.traditional}。`,
        vietnamese: `Chúng tôi đều thích ${w1.meaningVi}.`,
      },
      {
        simplified: `${w2.simplified}让我们很开心。`,
        traditional: `${w2.traditional}讓我們很開心。`,
        vietnamese: `${w2.meaningVi} khiến chúng tôi rất vui.`,
      },
      { simplified: '今天真是美好的一天。', traditional: '今天真是美好的一天。', vietnamese: 'Hôm nay thật là một ngày tuyệt vời.' },
    ];

    return { titleSimplified: '美好的一天', titleTraditional: '美好的一天', paragraphs };
  }

  private matchVocabularyUsed(paragraphs: StoryParagraph[], candidateWords: CandidateWord[]): StoryVocabularyUsed[] {
    const fullText = paragraphs.map((p) => p.simplified + p.traditional).join('');
    const used: StoryVocabularyUsed[] = [];
    const seen = new Set<string>();
    for (const w of candidateWords) {
      if (seen.has(w.simplified)) continue;
      if (fullText.includes(w.simplified) || fullText.includes(w.traditional)) {
        used.push({ simplified: w.simplified, traditional: w.traditional, pinyin: w.pinyin, meaningVi: w.meaningVi });
        seen.add(w.simplified);
      }
    }
    return used;
  }

  // Chinese text has no whitespace between words — "word count" here means
  // Hanzi character count, used only for the reader's estimated-read-time badge.
  private countHanzi(text: string): number {
    const matches = text.match(/[一-鿿]/g);
    return matches ? matches.length : 0;
  }
}
