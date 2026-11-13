import { domainMatches, emailDomain, parseToolCalls } from './tools.ts';
import type { DefenseConfig, RunContext } from './types.ts';

export const DEFENSE_NAMES = ['delimit', 'datamark', 'sandwich', 'outputFilter', 'toolGuard'] as const;
export type DefenseName = (typeof DEFENSE_NAMES)[number];

const PRESETS: Record<string, DefenseName[]> = {
  none: [],
  prompt: ['delimit', 'datamark', 'sandwich'],
  output: ['outputFilter', 'toolGuard'],
  all: [...DEFENSE_NAMES],
};

/** Accepts a preset name (none, prompt, output, all) or a comma list such as "delimit,toolGuard". */
export function parseDefenses(spec: string): { config: DefenseConfig; label: string } {
  const names = PRESETS[spec] ?? spec.split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of names) {
    if (!(DEFENSE_NAMES as readonly string[]).includes(n)) {
      throw new Error(`Unknown defense "${n}". Use a preset (${Object.keys(PRESETS).join(', ')}) or any of: ${DEFENSE_NAMES.join(', ')}`);
    }
  }
  const config = Object.fromEntries(DEFENSE_NAMES.map((n) => [n, names.includes(n)])) as unknown as DefenseConfig;
  const label = PRESETS[spec] ? spec : names.join('+') || 'none';
  return { config, label };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Output filter: what an app can do after the model answers and before the UI renders it.
 * 1. Drop markdown images and links that point outside trusted domains.
 * 2. Redact the app's own secret if it appears verbatim or base64-encoded.
 * It deliberately does nothing smarter than that, so the report shows where simple filters fall short.
 */
export function applyOutputFilter(output: string, ctx: RunContext): string {
  let out = output.replace(/(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?[^)]*\)/g, (whole, bang: string, text: string, url: string) => {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      return whole; // relative links are fine
    }
    if (ctx.trustedDomains.some((d) => domainMatches(host, d))) return whole;
    return bang ? '[image removed]' : `${text} [link removed]`;
  });

  out = out.replace(new RegExp(escapeRegExp(ctx.canary), 'gi'), '[REDACTED]');
  for (const needle of base64Needles(ctx.canary)) out = out.replaceAll(needle, '[REDACTED]');
  return out;
}

/**
 * Base64 of a secret looks different depending on where the secret sits in the
 * encoded text (its byte offset mod 3). Encode it at all three offsets and keep
 * only the characters that depend on the secret alone, so the filter catches
 * the secret inside base64 of a longer text too.
 */
export function base64Needles(secret: string): string[] {
  return [0, 1, 2].map((pad) => {
    const encoded = Buffer.from('\0'.repeat(pad) + secret).toString('base64').replace(/=+$/, '');
    const skipStart = [0, 2, 3][pad]!; // characters mixed with the bytes before the secret
    return encoded.slice(skipStart, encoded.length - 3); // last characters mix with the bytes after it
  });
}

/**
 * Tool guard: the app checks each parsed tool call against policy before running it.
 * Email to anyone outside the company needs the user to confirm.
 */
export function applyToolGuard(output: string, ctx: RunContext): string {
  let out = output;
  for (const call of parseToolCalls(output)) {
    const domain = emailDomain(call.to);
    const internal = ctx.trustedDomains.some((d) => domainMatches(domain, d));
    if (!internal) {
      out = out.replace(call.line, `[tool call held: send_email to ${call.to || 'unknown'} needs user confirmation]`);
    }
  }
  return out;
}

export function applyOutputDefenses(output: string, ctx: RunContext, defenses: DefenseConfig): string {
  let out = output;
  if (defenses.toolGuard) out = applyToolGuard(out, ctx);
  if (defenses.outputFilter) out = applyOutputFilter(out, ctx);
  return out;
}
