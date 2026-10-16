import { describe, expect, it } from "vitest";
import { earningsProjection } from "../../src/lib/earnings-projection";

describe("illustrative projection, independent of accounting", () => {
  it("calculates visits times conversion fraction times commission", () => {
    expect(earningsProjection(100, 5, 10, false)).toBe(50);
    expect(earningsProjection(100, 5, 10, true)).toBe(600);
  });
  it("rounds to two decimals and permits zero", () => {
    expect(earningsProjection(33, 3, 1.23, false)).toBe(1.22);
    expect(earningsProjection(0, 0, 0, true)).toBe(0);
  });
  it.each([
    [-1, 5, 10], [1000001, 5, 10], [100, -1, 10], [100, 101, 10],
    [100, 5, -1], [100, 5, 100001], [NaN, 5, 10], [100, Infinity, 10], [100, 5, NaN],
  ])("rejects invalid assumptions %j", (visits, rate, commission) => {
    expect(earningsProjection(visits, rate, commission, false)).toBeNull();
  });
  it("supports the declared input boundaries", () => {
    expect(earningsProjection(1000000, 100, 100000, true)).toBe(1200000000000);
  });
});