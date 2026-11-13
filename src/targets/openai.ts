import { postJson } from './http.ts';
import type { ChatMessage, Target } from '../types.ts';

/**
 * Any OpenAI-compatible Chat Completions endpoint: OpenAI, Groq, OpenRouter,
 * Google's Gemini OpenAI-compatible endpoint, a local Ollama server, and so on.
 */
export class OpenAICompatibleTarget implements Target {
  name = 'openai-compatible';

  constructor(
    public model: string,
    private apiKey: string,
    private baseUrl: string,
    private temperature?: number,
  ) {}

  async complete(system: string, messages: ChatMessage[]): Promise<string> {
    const data = await postJson(
      `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      { authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        messages: [{ role: 'system', content: system }, ...messages],
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      },
    );
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((p: any) => p?.text ?? '').join('');
    return '';
  }
}
