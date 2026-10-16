import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/access", () => ({ requireAccess: access }));
import Dashboard from "../../src/app/dashboard/page";

beforeEach(() => vi.resetAllMocks());

describe("revenue workspace integration boundary", () => {
  it("requires affiliate authorization before rendering", async () => {
    access.mockRejectedValue(new Error("unauthorized"));
    await expect(Dashboard()).rejects.toThrow("unauthorized");
    expect(access).toHaveBeenCalledExactlyOnceWith("affiliate");
  });
  it("renders unavailable states instead of fake balances or payment records", async () => {
    access.mockResolvedValue({});
    const html = renderToStaticMarkup(await Dashboard());
    expect(html).toContain("Reporting is not connected");
    expect(html).toContain("not a zero balance");
    expect(html.match(/aria-label="Not connected"/g)).toHaveLength(8);
    expect(html).toContain("Referral tracking and order credit are not activated yet");
    expect(html).toContain('href="/dashboard/referrals"');
    expect(html).toContain("No payment records or available balances are shown");
    expect(html).not.toContain("$0");
    expect(html).not.toContain("href=\"/r/");
  });
});