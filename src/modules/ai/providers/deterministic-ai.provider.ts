import { Injectable } from '@nestjs/common';
import type { AIProvider, AIChatMessage, AIChatResponse, AISummaryInput, AISummaryResponse } from './ai-provider.interface.js';

const TIPS: string[] = [
  'Hãy ôn lại từ vựng HSK mỗi sáng để duy trì tiến độ học.',
  'Lên kế hoạch chi tiêu trước đầu tháng giúp tiết kiệm hiệu quả hơn.',
  'Chia nhỏ mục tiêu lớn thành các bước nhỏ 25 phút mỗi ngày.',
  'Theo dõi thu chi hàng tuần để phát hiện sớm chi tiêu quá mức.',
  'Dành 30 phút mỗi tối để ôn lại kế hoạch ngày hôm sau.',
  'Tự động hóa tiết kiệm: chuyển tiền ngay khi nhận lương.',
  'Uống đủ nước và nghỉ giải lao 5 phút sau mỗi 25 phút học.',
];

@Injectable()
export class DeterministicAIProvider implements AIProvider {
  readonly name = 'deterministic';
  isAvailable(): boolean { return true; }
  supportsVision(): boolean { return false; }

  async generateText(_prompt: string): Promise<string> {
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    return tip ?? '';
  }

  async generateTextWithVision(_imageBase64: string, _mimeType: string, _prompt: string): Promise<string> {
    return '';
  }

  async chat(messages: AIChatMessage[]): Promise<AIChatResponse> {
    const last = messages[messages.length - 1]?.content ?? '';
    const lower = last.toLowerCase();
    let reply: string;

    if (lower.includes('tài chính') || lower.includes('tiết kiệm') || lower.includes('finance')) {
      reply = 'Để cải thiện tài chính, hãy theo dõi chi tiêu hàng ngày và đặt ngân sách cho từng danh mục. Tiết kiệm tối thiểu 20% thu nhập mỗi tháng là mục tiêu tốt.';
    } else if (lower.includes('học') || lower.includes('hsk') || lower.includes('tiếng trung')) {
      reply = 'Để học tiếng Trung hiệu quả, hãy học 5-10 từ mới mỗi ngày và ôn lại theo phương pháp spaced repetition. Thực hành đều đặn quan trọng hơn học nhiều một lúc.';
    } else if (lower.includes('mục tiêu') || lower.includes('goal')) {
      reply = 'Hãy đặt mục tiêu SMART: Specific (cụ thể), Measurable (đo được), Achievable (khả thi), Relevant (liên quan), Time-bound (có thời hạn). Theo dõi tiến độ hàng tuần.';
    } else if (lower.includes('lịch') || lower.includes('kế hoạch') || lower.includes('schedule')) {
      reply = 'Lập kế hoạch ngày từ tối hôm trước. Ưu tiên 3 việc quan trọng nhất và hoàn thành trước 12 giờ trưa khi năng lượng còn cao.';
    } else {
      const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
      reply = `${tip} Có điều gì khác tôi có thể giúp bạn không?`;
    }

    return { message: reply, provider: this.name };
  }

  async generateSummary(input: AISummaryInput): Promise<AISummaryResponse> {
    const ctx = input.context as Record<string, unknown>;
    const parts: string[] = [];

    const finance = ctx.finance as Record<string, unknown> | undefined;
    if (finance) {
      const savings = Number(finance.netSavings ?? 0);
      if (savings < 0) {
        parts.push(`Tài chính: chi tiêu vượt thu nhập ${Math.abs(savings).toLocaleString('vi-VN')} TWD.`);
      } else {
        parts.push(`Tài chính: tiết kiệm được ${savings.toLocaleString('vi-VN')} TWD tháng này.`);
      }
    }

    const learning = ctx.learning as Record<string, unknown> | undefined;
    if (learning) {
      const due = Number(learning.reviewDueCount ?? 0);
      const learned = Number(learning.learnedWords ?? 0);
      parts.push(`Học tập: ${learned} từ đã học, ${due} từ cần ôn hôm nay.`);
    }

    const schedule = ctx.schedule as Record<string, unknown> | undefined;
    if (schedule) {
      const overdue = Number(schedule.overdueTasks ?? 0);
      const completed = Number(schedule.completedThisWeek ?? 0);
      parts.push(`Lịch trình: hoàn thành ${completed} việc tuần này${overdue > 0 ? `, còn ${overdue} việc quá hạn` : ''}.`);
    }

    const summary = parts.length > 0
      ? `Tóm tắt hôm nay: ${parts.join(' ')}`
      : 'Chào buổi sáng! Hãy bắt đầu ngày mới với một kế hoạch rõ ràng.';

    return { summary, provider: this.name };
  }
}
