import "server-only";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

/**
 * MyInvestor catalog MCP (official, public, no auth).
 *
 * The server at `mcp.myinvestor.es` exposes the MyInvestor fund + automated-
 * portfolio CATALOG as read-only tools (search/compare/resolve funds and
 * portfolios). It does NOT expose the Commander's own positions — so it is a
 * product-discovery surface for the advisor, never a source of truth for the
 * portfolio (manual entry + the recompute engine own that).
 *
 * Wired into the advisor chat via the Agent SDK's `mcpServers` option; tools
 * surface as `mcp__myinvestor__*` and must be allow-listed because the chat
 * runs with `permissionMode: "dontAsk"` (deny-by-default).
 */

export const MYINVESTOR_SERVER_NAME = "myinvestor";
export const MYINVESTOR_MCP_DEFAULT_URL = "https://mcp.myinvestor.es/mcp";

export type MyInvestorMcp = {
  mcpServers: NonNullable<Options["mcpServers"]>;
  /** Tools to add to the advisor's allow-list (wildcard over the whole server). */
  allowedTools: string[];
};

/**
 * Returns the MyInvestor catalog MCP wiring for the advisor chat, or `null`
 * when disabled via `ADVISOR_MYINVESTOR_ENABLED=false`. The endpoint can be
 * overridden with `MYINVESTOR_MCP_URL`.
 */
export function myInvestorMcp(
  env: Record<string, string | undefined> = process.env,
): MyInvestorMcp | null {
  if (env.ADVISOR_MYINVESTOR_ENABLED === "false") return null;
  const url = env.MYINVESTOR_MCP_URL?.trim() || MYINVESTOR_MCP_DEFAULT_URL;
  return {
    mcpServers: { [MYINVESTOR_SERVER_NAME]: { type: "http", url } },
    allowedTools: [`mcp__${MYINVESTOR_SERVER_NAME}__*`],
  };
}
