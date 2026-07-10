export type SensitiveFinding = { label: string; sample: string };

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ["OpenAI-style API key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["credential assignment", /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9_\-/.+=]{16,}/i],
];

export function findSensitiveText(text: string): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  for (const [label, pattern] of SECRET_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      findings.push({ label, sample: `${match[0].slice(0, 4)}…[redacted]` });
    }
  }
  return findings;
}

export function assertSafeForRemote(text: string, allowSensitive: boolean): void {
  if (allowSensitive) return;
  const findings = findSensitiveText(text);
  if (findings.length > 0) {
    throw new Error(
      `Remote model call blocked: detected ${findings.map((item) => item.label).join(", ")}. ` +
        "Inspect the source and pass --allow-sensitive only after confirming remote transmission.",
    );
  }
}
