import { describe, expect, it } from "vitest";
import { spreadsheetId } from "./sheets";

describe("spreadsheetId", () => {
  it("リンクから ID を取り出す", () => {
    expect(spreadsheetId("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
  });
  it("スプシのリンクでなければ null", () => {
    expect(spreadsheetId("https://example.com/foo")).toBeNull();
  });
});
