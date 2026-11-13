import { randomBytes } from 'node:crypto';
import type { RunContext } from './types.ts';

const hex = (bytes: number) => randomBytes(bytes).toString('hex').toUpperCase();

export function newContext(): RunContext {
  return {
    canary: `REF-${hex(2)}-${hex(2)}`,
    marker: `ACK-${hex(3)}`,
    attackerDomain: 'attacker.example',
    trustedDomains: ['acme.example'],
  };
}

export function fill(text: string, ctx: RunContext): string {
  return text.replaceAll('{{MARKER}}', ctx.marker).replaceAll('{{ATTACKER}}', ctx.attackerDomain);
}
