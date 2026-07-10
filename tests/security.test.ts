import { describe, expect, it } from "vitest";
import { assertSafeForRemote, findSensitiveText } from "../src/security.js";

describe("credential guard", () => {
  it("detects and redacts obvious credentials", () => {
    const findings = findSensitiveText("api_key=abcdefghijklmnop123456");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.sample).toBe("api_…[redacted]");
    expect(JSON.stringify(findings)).not.toContain("abcdefghijklmnop123456");
  });

  it("blocks remote transmission unless explicitly allowed", () => {
    const text = "password: very-long-password-value";
    expect(() => assertSafeForRemote(text, false)).toThrow(/blocked/);
    expect(() => assertSafeForRemote(text, true)).not.toThrow();
  });
});
