import { describe, expect, it } from "vitest";
import { extractFtXid, parseFtHistory, parseFtQuote } from "./ft";

// Trimmed copies of the real markets.ft.com responses for the Groupama
// Trésorerie fund (symbol FR0000989626:EUR, internal xid 29804275). FT uses
// the English number format: ',' thousands, '.' decimal.
const TEARSHEET_HTML = `
<section data-mod-config="{&quot;xid&quot;:&quot;29804275&quot;,&quot;assetClass&quot;:&quot;FUND&quot;}">
  <ul class="mod-ui-data-list">
    <li><span>Price (EUR)</span><span class="mod-ui-data-list__value">44,339.26</span></li>
  </ul>
  <div class="mod-disclaimer">Data delayed at least 15 minutes, as of Jun 25 2026.</div>
</section>`;

// The get-historical-prices endpoint returns JSON whose `html` field is a run
// of <tr> rows: a date cell (long + short span) then O/H/L/C cells + volume.
const HISTORY_JSON = JSON.stringify({
  data: {},
  html:
    `<tr><td class="mod-ui-table__cell--text"><span class="mod-ui-hide-small-below">Thursday, June 25, 2026</span><span class="mod-ui-hide-medium-above">Thu, Jun 25, 2026</span></td><td>44,339.26</td><td>44,339.26</td><td>44,339.26</td><td>44,339.26</td><td><span>0</span></td></tr>` +
    `<tr><td class="mod-ui-table__cell--text"><span class="mod-ui-hide-small-below">Wednesday, June 24, 2026</span><span class="mod-ui-hide-medium-above">Wed, Jun 24, 2026</span></td><td>44,335.10</td><td>44,335.10</td><td>44,335.10</td><td>44,336.00</td><td><span>0</span></td></tr>`,
});

describe("extractFtXid", () => {
  it("pulls the entity-encoded xid out of a tearsheet", () => {
    expect(extractFtXid(TEARSHEET_HTML)).toBe("29804275");
  });
  it("also matches a plain-quoted xid", () => {
    expect(extractFtXid(`<div data-x='{"xid":"123456"}'>`)).toBe("123456");
  });
  it("returns null when there is no xid", () => {
    expect(extractFtXid("<html></html>")).toBeNull();
  });
});

describe("parseFtQuote", () => {
  it("extracts the NAV, currency and as-of date from the tearsheet", () => {
    const q = parseFtQuote(TEARSHEET_HTML, "FR0000989626:EUR");
    expect(q.symbol).toBe("FR0000989626:EUR");
    expect(q.price).toBeCloseTo(44339.26, 6);
    expect(q.currency).toBe("EUR");
    expect(q.asOf.toISOString()).toBe("2026-06-25T00:00:00.000Z");
  });

  it("throws when no price is present", () => {
    expect(() => parseFtQuote("<html>nope</html>", "X:EUR")).toThrow(/price/i);
  });
});

describe("parseFtHistory", () => {
  it("returns one bar per row using the close (4th price cell)", () => {
    const bars = parseFtHistory(HISTORY_JSON, "FR0000989626:EUR");
    expect(bars).toEqual([
      { date: "2026-06-25", close: 44339.26, currency: "EUR" },
      { date: "2026-06-24", close: 44336.0, currency: "EUR" },
    ]);
  });

  it("returns an empty list when the html has no rows", () => {
    expect(parseFtHistory(JSON.stringify({ html: "" }), "X:EUR")).toEqual([]);
  });
});
