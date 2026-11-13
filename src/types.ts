export type Role = 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export type Category =
  | 'system-prompt-leak'
  | 'indirect-injection'
  | 'data-exfiltration'
  | 'tool-hijack';

export type UntrustedSource = 'document' | 'email' | 'web-page' | 'tool-result';

/** One message in a scenario. Untrusted content is kept separate so the app (and its defenses) decides how to embed it. */
export interface Turn {
  role: Role;
  text: string;
  untrusted?: { source: UntrustedSource; content: string };
}

export type CheckName = 'canary-leak' | 'marker' | 'attacker-link' | 'tool-hijack';

export interface Scenario {
  id: string;
  title: string;
  category: Category;
  vector: 'direct' | 'indirect';
  /** OWASP Top 10 for LLM Applications (2025) entries this scenario exercises. */
  owasp: string[];
  description: string;
  /** Whether the app exposes the send_email tool in this scenario. */
  tools?: boolean;
  turns: Turn[];
  /** Detectors that decide whether the attack worked. Any hit means the attack succeeded. */
  checks: CheckName[];
}

/** Fresh random values for every trial, so outputs from one trial can never satisfy another. */
export interface RunContext {
  /** Secret placed only in the system prompt. The attacker never sees it. */
  canary: string;
  /** Token an injected instruction asks the model to print. */
  marker: string;
  /** Reserved domain (RFC 2606) standing in for attacker infrastructure. */
  attackerDomain: string;
  /** Domains the app treats as its own. */
  trustedDomains: string[];
}

export interface Target {
  name: string;
  model: string;
  complete(system: string, messages: ChatMessage[]): Promise<string>;
}

export interface DefenseConfig {
  delimit: boolean;
  datamark: boolean;
  sandwich: boolean;
  outputFilter: boolean;
  toolGuard: boolean;
}

export interface Finding {
  check: CheckName;
  evidence: string;
}

/**
 * succeeded: the attack is visible in what the app would show or execute.
 * blocked:   the model was compromised, but an output-side defense stopped it.
 * resisted:  the model did not do what the injection asked.
 * error:     the request failed.
 */
export type Outcome = 'succeeded' | 'blocked' | 'resisted' | 'error';

export interface TrialResult {
  scenarioId: string;
  trial: number;
  outcome: Outcome;
  rawFindings: Finding[];
  finalFindings: Finding[];
  rawOutput: string;
  finalOutput: string;
  error?: string;
}

export interface RunResult {
  target: string;
  model: string;
  defenses: DefenseConfig;
  defenseLabel: string;
  repeats: number;
  startedAt: string;
  finishedAt: string;
  scenarios: Scenario[];
  trials: TrialResult[];
}
