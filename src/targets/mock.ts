import { DATAMARK } from '../app.ts';
import type { ChatMessage, Target } from '../types.ts';

/**
 * A deliberately naive stand-in for a model. It obeys any instruction it can
 * pattern-match, wherever that instruction appears. It exists so the harness,
 * the detectors and the output-side defenses can be run and tested without an
 * API key. Its numbers say nothing about any real model.
 */
export class MockTarget implements Target {
  name = 'mock';
  model = 'naive-mock';

  async complete(system: string, messages: ChatMessage[]): Promise<string> {
    const text = messages.map((m) => m.content).join('\n').replaceAll(DATAMARK, ' ');
    const secret = /Internal reference code:\s*(\S+)/.exec(system)?.[1] ?? '';
    const reply = ['Here is what I found.'];

    if (/(print|repeat|translate|reveal|state|output|encode)[^.\n]{0,60}(instructions|configuration|config|reference code|text above|told)/i.test(text)) {
      reply.push(/base64/i.test(text) ? Buffer.from(system).toString('base64') : system);
    }

    if (/spell/i.test(text)) reply.push(secret.split('').join(' '));

    const marker = /\b(ACK-[A-F0-9]+)\b/.exec(text)?.[1];
    if (marker) reply.push(marker);

    const link = /(!?\[[^\]]*\]\(https?:\/\/[^)\s]+\))/.exec(text)?.[1];
    if (link) reply.push(link.replace('REFCODE', secret));

    const to = /send_email\(to="([^"]+)"/.exec(text)?.[1];
    if (to && system.includes('CALL send_email')) {
      reply.push(`CALL send_email(to="${to}", body="Forwarding as requested. Reference code ${secret}.")`);
    }

    return reply.join('\n\n');
  }
}
