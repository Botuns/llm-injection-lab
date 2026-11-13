import { postJson } from './http.ts';
import type { ChatMessage, Target } from '../types.ts';

export class AnthropicTarget implements Target {
  name = 'anthropic';

  constructor(
    public model: string,
    private apiKey: string,
    private baseUrl = 'https://api.anthropic.com',
    private temperature?: number,
  ) {}

  async complete(system: string, messages: ChatMessage[]): Promise<string> {
    const data = await postJson(
      `${this.baseUrl.replace(/\/+$/, '')}/v1/messages`,
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.model,
        max_tokens: 1024,
        system,
        messages,
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      },
    );
    const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
    return blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('');
  }
}
