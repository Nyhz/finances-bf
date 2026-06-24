import { describe, expect, it, vi } from "vitest";
import type { HistoricalBar } from "../../pricing/types";
import { parseProposals, runDiscover, type RunAgent } from "../discover";
import type { VerifyClients } from "../verify";

function bars(closes: number[]): HistoricalBar[] {
  return closes.map((close, i) => ({ date: `2026-01-${(i % 28) + 1}`, close, currency: "USD" }));
}

function clients(map: Record<string, number[]>): VerifyClients {
  return {
    fetchHistory: async (symbol) => {
      if (!(symbol in map)) throw new Error("no data");
      return bars(map[symbol]);
    },
    fetchQuote: async (symbol) => {
      const c = map[symbol];
      return { symbol, price: c[c.length - 1], currency: "USD", asOf: new Date() };
    },
    fetchAssetSector: async () => null,
  };
}

const usage = { costUsd: 0, inputTokens: 10, outputTokens: 5, webSearches: 1, isError: false };

function agentReturning(proposals: unknown): RunAgent {
  const text = "Resultado:\n```json\n" + JSON.stringify(proposals) + "\n```";
  return vi.fn(async () => ({ text, ...usage }));
}

describe("discover/parseProposals", () => {
  it("extracts a fenced json array", () => {
    const text = "blah\n```json\n[{\"symbol\":\"AAA\",\"name\":\"A\",\"criterion\":\"below_dma200\",\"thesis\":\"t\"}]\n```";
    const p = parseProposals(text);
    expect(p).toHaveLength(1);
    expect(p?.[0].symbol).toBe("AAA");
  });
  it("rejects an unknown criterion", () => {
    const text = "```json\n[{\"symbol\":\"AAA\",\"name\":\"A\",\"criterion\":\"nope\",\"thesis\":\"t\"}]\n```";
    expect(parseProposals(text)).toBeNull();
  });
  it("returns null when there is no json", () => {
    expect(parseProposals("no hay nada aquí")).toBeNull();
  });
});

describe("discover/runDiscover", () => {
  it("keeps only confirmed, counts refuted and unverifiable", async () => {
    const under = Array(250).fill(100);
    for (let i = 240; i < 250; i++) under[i] = 70; // AAA confirmed
    const over = Array(250).fill(100);
    over[249] = 130; // BBB refuted

    const result = await runDiscover({
      model: "test",
      now: new Date(),
      clients: clients({ AAA: under, BBB: over }), // CCC missing → unverifiable
      runAgent: agentReturning([
        { symbol: "AAA", name: "Alpha", criterion: "below_dma200", thesis: "x" },
        { symbol: "BBB", name: "Beta", criterion: "below_dma200", thesis: "y" },
        { symbol: "CCC", name: "Gamma", criterion: "below_dma200", thesis: "z" },
      ]),
    });

    expect(result.proposalCount).toBe(3);
    expect(result.confirmedCount).toBe(1);
    expect(result.refutedCount).toBe(1);
    expect(result.unverifiableCount).toBe(1);
    expect(result.confirmed[0].symbol).toBe("AAA");
    expect(result.confirmed[0].detail).toContain("DMA200");
  });

  it("throws when the agent never returns valid json", async () => {
    const runAgent: RunAgent = vi.fn(async () => ({ text: "sin json", ...usage }));
    await expect(
      runDiscover({ model: "test", clients: clients({}), runAgent }),
    ).rejects.toThrow();
  });
});
