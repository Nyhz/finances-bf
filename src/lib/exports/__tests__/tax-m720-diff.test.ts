import { describe, expect, it } from "vitest";
import { buildM720DiffJson, buildM720DiffCsv } from "../tax-m720-diff";
import type { InformationalModelsStatus } from "../../../server/tax/m720";

const models: InformationalModelsStatus = {
  m720: { blocks: [
    { country: "IE", type: "broker-securities", valueEur: 80_000, status: "delta_20k", lastDeclaredEur: 55_000 },
    { country: "NL", type: "broker-securities", valueEur: 10_000, status: "ok", lastDeclaredEur: null },
  ] },
  m721: { blocks: [
    { country: "MT", type: "crypto", valueEur: 60_000, status: "new", lastDeclaredEur: null },
  ] },
  d6: { blocks: [] },
};

describe("buildM720DiffJson / Csv", () => {
  it("JSON shape has per-model arrays and summary", () => {
    const json = JSON.parse(buildM720DiffJson(models));
    expect(json.m720.blocks).toHaveLength(2);
    expect(json.m721.blocks).toHaveLength(1);
    expect(json.summary.needsAction).toBe(true);
  });
  it("CSV lists flagged blocks", () => {
    const csv = buildM720DiffCsv(models);
    expect(csv).toContain("m720,IE,broker-securities,delta_20k");
    expect(csv).toContain("m721,MT,crypto,new");
  });
});
