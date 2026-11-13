export interface ToolCall {
  name: 'send_email';
  to: string;
  body: string;
  /** The full line as the model wrote it. */
  line: string;
}

// Mirrors the app's tool parser: a call only counts when it sits on its own
// line in the documented format. A model that merely mentions send_email
// while refusing is not calling it.
const CALL_LINE = /^[ \t>*-]*`{0,3}CALL\s+send_email\s*\((.*)\)`{0,3}[ \t]*$/gm;

export function parseToolCalls(output: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const match of output.matchAll(CALL_LINE)) {
    const args = match[1] ?? '';
    calls.push({
      name: 'send_email',
      to: /to\s*=\s*["']([^"']+)["']/.exec(args)?.[1]?.trim() ?? '',
      body: /body\s*=\s*["']([\s\S]*)["']/.exec(args)?.[1] ?? '',
      line: match[0],
    });
  }
  return calls;
}

export function emailDomain(address: string): string {
  return address.split('@').pop()?.toLowerCase().trim() ?? '';
}

export function domainMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}
