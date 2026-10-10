import { describe, expect, it } from "vitest";
import { formatDateTimeTokyo, formatDateTokyo } from "./format";

describe("日時の表示(日本時間 Asia/Tokyo を明示)", () => {
  it("UTC の日時を日本時間(+9 時間)で「年-月-日 時:分」に。0 埋め・年つき", () => {
    expect(formatDateTimeTokyo("2026-10-10T05:05:00Z")).toBe("2026-10-10 14:05");
    expect(formatDateTimeTokyo("2026-01-02T00:04:00Z")).toBe("2026-01-02 09:04");
  });

  it("日付をまたぐ: UTC の 15:00 以降は日本では翌日。年またぎ", () => {
    expect(formatDateTimeTokyo("2026-10-10T15:00:00Z")).toBe("2026-10-11 00:00");
    expect(formatDateTimeTokyo("2026-12-31T15:30:00Z")).toBe("2027-01-01 00:30");
    expect(formatDateTokyo("2026-10-10T14:59:59Z")).toBe("2026-10-10");
    expect(formatDateTokyo("2026-10-10T15:00:00Z")).toBe("2026-10-11");
  });

  it("0 時は 00(24 ではない)", () => {
    expect(formatDateTimeTokyo("2026-10-09T15:00:00.000Z")).toBe("2026-10-10 00:00");
  });

  it("秒・ミリ秒・時差つきの書き方でも同じ瞬間なら同じ文字", () => {
    expect(formatDateTimeTokyo("2026-10-10T14:05:59.999+09:00")).toBe("2026-10-10 14:05");
    expect(formatDateTimeTokyo("2026-10-10T05:05:30+00:00")).toBe("2026-10-10 14:05");
  });

  it("実行環境の時刻帯に左右されない(TZ を変えても同じ)", () => {
    const before = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Auckland"]) {
        process.env.TZ = tz;
        expect(formatDateTimeTokyo("2026-10-10T05:05:00Z"), tz).toBe("2026-10-10 14:05");
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("読めない日時は空", () => {
    expect(formatDateTimeTokyo("not a date")).toBe("");
    expect(formatDateTokyo("")).toBe("");
  });
});
