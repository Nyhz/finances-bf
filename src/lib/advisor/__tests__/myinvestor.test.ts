import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MYINVESTOR_MCP_DEFAULT_URL,
  MYINVESTOR_SERVER_NAME,
  myInvestorMcp,
} from "../myinvestor";
import { buildChatSystemPrompt } from "../prompts";

describe("myInvestorMcp", () => {
  const SAVED = { ...process.env };
  beforeEach(() => {
    process.env = { ...SAVED };
  });
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("returns the default catalog endpoint and a server-wide allow-list", () => {
    delete process.env.ADVISOR_MYINVESTOR_ENABLED;
    delete process.env.MYINVESTOR_MCP_URL;
    const r = myInvestorMcp();
    expect(r).not.toBeNull();
    expect(r!.mcpServers[MYINVESTOR_SERVER_NAME]).toEqual({
      type: "http",
      url: MYINVESTOR_MCP_DEFAULT_URL,
    });
    // Wildcard must be anchored to the server prefix (unanchored globs are ignored by the SDK).
    expect(r!.allowedTools).toEqual([`mcp__${MYINVESTOR_SERVER_NAME}__*`]);
  });

  it("honours a custom endpoint override", () => {
    process.env.MYINVESTOR_MCP_URL = "https://example.test/mcp";
    expect(myInvestorMcp()!.mcpServers[MYINVESTOR_SERVER_NAME]).toMatchObject({
      url: "https://example.test/mcp",
    });
  });

  it("is null when disabled", () => {
    process.env.ADVISOR_MYINVESTOR_ENABLED = "false";
    expect(myInvestorMcp()).toBeNull();
  });

  it("reads from an explicit env argument", () => {
    expect(myInvestorMcp({ ADVISOR_MYINVESTOR_ENABLED: "false" })).toBeNull();
    expect(myInvestorMcp({})).not.toBeNull();
  });
});

describe("buildChatSystemPrompt — MyInvestor section", () => {
  const base = { portfolio: "P", profile: "Q", digest: "D", summaries: "" };

  it("appends the catalog section only when enabled", () => {
    expect(buildChatSystemPrompt(base)).not.toMatch(/Catálogo MyInvestor/);
    expect(buildChatSystemPrompt({ ...base, myInvestor: false })).not.toMatch(
      /Catálogo MyInvestor/,
    );
    const withTools = buildChatSystemPrompt({ ...base, myInvestor: true });
    expect(withTools).toMatch(/Catálogo MyInvestor/);
    // The bias caveat must be present so recommendations are framed honestly.
    expect(withTools).toMatch(/no son research independiente/i);
  });
});
