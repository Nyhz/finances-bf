import { describe, expect, it } from "vitest";
import type { HistoricalBar } from "../../pricing/types";
import { discoverStream, type DiscoverEvent, type StreamAgent } from "../stream";
import type { VerifyClients } from "../verify";

function clients(map: Record<string, number[]>): VerifyClients {
  return {
    fetchHistory: async (symbol) => {
      if (!(symbol in map)) throw new Error("no data");
      return map[symbol].map((close, i): HistoricalBar => ({ date: `2026-01-${(i % 28) + 1}`, close, currency: "USD" }));
    },
    fetchQuote: async (symbol) => {
      const c = map[symbol];
      return { symbol, price: c[c.length - 1], currency: "USD", asOf: new Date() };
    },
    fetchAssetSector: async () => null,
  };
}

const usage = { costUsd: 0, inputTokens: 1, outputTokens: 1, webSearches: 1, isError: false };

function agent(proposals: unknown): StreamAgent {
  const text = "Voy buscando…\n```json\n" + JSON.stringify(proposals) + "\n```";
  return async function* () {
    yield { type: "delta", text: "Voy buscando acciones bajo su DMA200… " };
    yield { type: "done", text, usage };
  };
}

describe("discover/discoverStream", () => {
  it("streams narration + per-candidate verification and returns the result", async () => {
    const under = Array(250).fill(100);
    for (let i = 240; i < 250; i++) under[i] = 70; // AAA confirmed

    const it = discoverStream({
      model: "test",
      clients: clients({ AAA: under }),
      streamAgent: agent([{ symbol: "AAA", name: "Alpha", criterion: "below_dma200", thesis: "x" }]),
    });

    const events: DiscoverEvent[] = [];
    let result;
    for (;;) {
      const { value, done } = await it.next();
      if (done) {
        result = value;
        break;
      }
      events.push(value);
    }

    expect(events.some((e) => e.type === "thinking")).toBe(true);
    expect(events.some((e) => e.type === "found")).toBe(true);
    const verify = events.find((e) => e.type === "verify");
    expect(verify).toMatchObject({ type: "verify", symbol: "AAA", status: "confirmed", total: 1 });
    expect(result?.confirmedCount).toBe(1);
  });
});
