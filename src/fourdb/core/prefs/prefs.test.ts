import { describe, expect, it } from "vitest";
import { CUSTOM_PATTERN_LABEL, LOOK_KEY_LABELS, LOOK_VALUE_LABELS, PATTERN_LABELS, THEME_LABELS, WORLD_LABELS } from "./labels";
import { DEFAULT_LOOK, DEFAULT_PATTERN_ID, isLookValue, LOOK_KEYS, LOOK_OPTIONS, parseLookLenient, parseLookStrict, PATTERNS, patternOf, type Look, type LookKey } from "./look";
import { defaultPrefs, DEFAULT_WORLD, isTheme, isWorldId, parsePrefsLenient, parsePrefsPatch, THEMES, WORLDS } from "./prefs";

// 既定(DEFAULT_LOOK)と 6 つの部品がすべて違う見た目。「既定に戻した」と「そのまま通した」を見分けるため(下の最初の試験で確かめる)
const good = (): Look => ({ shape: "solid", tilt: "vertex", base: "stone", label: "front", bg: "grid", layout: "stage" });
const asRecord = (v: unknown) => v as Record<string, unknown>;

describe("試験用の good()", () => {
  it("既定(DEFAULT_LOOK)と、どの部品も違う", () => {
    for (const k of LOOK_KEYS) expect(good()[k], k).not.toBe(DEFAULT_LOOK[k]);
  });
});

describe("LOOK_OPTIONS: 部品の選択肢(英語の固定の目印)", () => {
  it("部品は shape・tilt・base・label・bg・layout の 6 つで、選択肢は決めたとおり", () => {
    expect(LOOK_KEYS).toEqual(["shape", "tilt", "base", "label", "bg", "layout"]);
    expect(Object.keys(LOOK_OPTIONS)).toEqual([...LOOK_KEYS]);
    expect(LOOK_OPTIONS).toEqual({
      shape: ["glass", "solid", "ribbon", "wire"],
      tilt: ["vertex", "flat"],
      base: ["dish", "plinth", "ring", "stone", "disc"],
      label: ["below", "front", "float"],
      bg: ["logo", "quiet", "grid"],
      layout: ["row", "arc", "stage"],
    });
  });
  it("選択肢に重複がなく、すべて英小文字だけ", () => {
    for (const k of LOOK_KEYS) {
      const o = LOOK_OPTIONS[k] as readonly string[];
      expect(new Set(o).size).toBe(o.length);
      for (const v of o) expect(v).toMatch(/^[a-z]+$/);
    }
  });
  it("isLookValue: 選択肢の文字列だけ", () => {
    expect(isLookValue("shape", "glass")).toBe(true);
    expect(isLookValue("shape", "flat")).toBe(false); // ほかの部品の値
    expect(isLookValue("shape", "Glass")).toBe(false);
    expect(isLookValue("shape", 1)).toBe(false);
    expect(isLookValue("shape", undefined)).toBe(false);
    expect(isLookValue("shape", ["glass"])).toBe(false);
  });
});

describe("PATTERNS・DEFAULT_LOOK・patternOf", () => {
  // 試作 home3d.js の 8 つ(box → shape)を、手で書き写した期待値
  const expected: [number, Look][] = [
    [1, { shape: "glass", tilt: "flat", base: "plinth", label: "below", bg: "logo", layout: "row" }],
    [2, { shape: "solid", tilt: "flat", base: "stone", label: "front", bg: "quiet", layout: "row" }],
    [3, { shape: "ribbon", tilt: "flat", base: "ring", label: "float", bg: "logo", layout: "arc" }],
    [4, { shape: "wire", tilt: "flat", base: "disc", label: "below", bg: "grid", layout: "row" }],
    [5, { shape: "glass", tilt: "flat", base: "disc", label: "float", bg: "quiet", layout: "arc" }],
    [6, { shape: "ribbon", tilt: "flat", base: "plinth", label: "below", bg: "logo", layout: "stage" }],
    [7, { shape: "glass", tilt: "vertex", base: "dish", label: "below", bg: "logo", layout: "row" }],
    [8, { shape: "ribbon", tilt: "vertex", base: "dish", label: "below", bg: "logo", layout: "row" }],
  ];
  it("試作の 8 つのパターンが、番号の順にある", () => {
    expect(PATTERNS.map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const [id, look] of expected) expect(PATTERNS.find((p) => p.id === id)?.look).toEqual(look);
  });
  it("どのパターンも、6 つの部品がすべて選択肢の値で、組み合わせが重ならない", () => {
    const seen = new Set<string>();
    for (const p of PATTERNS) {
      expect(Object.keys(p.look).sort()).toEqual([...LOOK_KEYS].sort());
      for (const k of LOOK_KEYS) expect(isLookValue(k, p.look[k])).toBe(true);
      seen.add(LOOK_KEYS.map((k) => p.look[k]).join("/"));
    }
    expect(seen.size).toBe(PATTERNS.length);
  });
  it("パターンは書き換えられない", () => {
    expect(Object.isFrozen(PATTERNS)).toBe(true);
    for (const p of PATTERNS) {
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.isFrozen(p.look)).toBe(true);
    }
    expect(() => {
      asRecord(PATTERNS[0].look).shape = "wire";
    }).toThrow();
  });
  it("既定はパターン 3「ロゴの宇宙」(帯つき・面を下・光の輪・Box の上の札・ロゴの線・弧)", () => {
    expect(DEFAULT_PATTERN_ID).toBe(3);
    expect(DEFAULT_LOOK).toEqual({ shape: "ribbon", tilt: "flat", base: "ring", label: "float", bg: "logo", layout: "arc" });
    expect(DEFAULT_LOOK).toEqual(expected[2][1]);
    expect(Object.isFrozen(DEFAULT_LOOK)).toBe(true);
    expect(patternOf(DEFAULT_LOOK)?.id).toBe(3);
    expect(PATTERN_LABELS[DEFAULT_PATTERN_ID].name).toBe("ロゴの宇宙");
  });
  it("patternOf: 6 つともそろえば、そのパターン", () => {
    for (const [id, look] of expected) expect(patternOf({ ...look })?.id).toBe(id);
  });
  it("patternOf: 部品を 1 つでも変えると、どれにも当たらない(null =「組み合わせ」)", () => {
    for (const p of PATTERNS)
      for (const k of LOOK_KEYS)
        for (const v of LOOK_OPTIONS[k] as readonly string[]) {
          if (v === p.look[k]) continue;
          const changed = { ...p.look, [k]: v } as Look;
          const hit = patternOf(changed);
          // 別のパターンにちょうど当たることはあっても、元のパターンではない
          expect(hit?.id).not.toBe(p.id);
          if (hit) expect(LOOK_KEYS.every((kk) => hit.look[kk] === changed[kk])).toBe(true);
        }
    expect(patternOf({ shape: "wire", tilt: "vertex", base: "ring", label: "front", bg: "grid", layout: "arc" })).toBeNull();
  });
  it("パターンの名前(仮)と説明が、すべてのパターンにある", () => {
    expect(Object.keys(PATTERN_LABELS).sort()).toEqual(PATTERNS.map((p) => String(p.id)).sort());
    for (const p of PATTERNS) {
      expect(PATTERN_LABELS[p.id].name).not.toBe("");
      expect(PATTERN_LABELS[p.id].mood).not.toBe("");
    }
    expect(CUSTOM_PATTERN_LABEL).toBe("組み合わせ");
  });
});

describe("部品の名前(日本語)が、すべての選択肢にある", () => {
  it("見出しは 6 つの部品、名前は選択肢ごと(過不足なし)", () => {
    expect(Object.keys(LOOK_KEY_LABELS)).toEqual([...LOOK_KEYS]);
    for (const k of LOOK_KEYS) {
      expect(Object.keys(LOOK_VALUE_LABELS[k]).sort()).toEqual([...(LOOK_OPTIONS[k] as readonly string[])].sort());
      for (const v of Object.values(LOOK_VALUE_LABELS[k])) expect(v).not.toBe("");
    }
  });
  it("作業指示 11 章の案のとおり", () => {
    expect(LOOK_VALUE_LABELS.shape).toEqual({ glass: "ガラス", solid: "つや消し", ribbon: "帯つき", wire: "線と点" });
    expect(LOOK_VALUE_LABELS.tilt).toEqual({ vertex: "角を下", flat: "面を下" });
    expect(LOOK_VALUE_LABELS.base).toEqual({ dish: "くぼみの台", plinth: "2 段の台", ring: "光の輪", stone: "石の台", disc: "床の円盤" });
    expect(LOOK_VALUE_LABELS.label).toEqual({ below: "台の下", front: "台の正面", float: "Box の上" });
    expect(LOOK_VALUE_LABELS.bg).toEqual({ logo: "ロゴの線", quiet: "静か", grid: "床の格子" });
    expect(LOOK_VALUE_LABELS.layout).toEqual({ row: "1 列", arc: "弧", stage: "ひな壇" });
    expect(THEME_LABELS).toEqual({ light: "明るい", dark: "暗い" });
    expect(WORLD_LABELS).toEqual({ plain: "無地" });
  });
});

describe("parseLookStrict(書き込み用。厳しく)", () => {
  it("6 つの部品がそろった正しい値は、新しいオブジェクトで返す", () => {
    const input = good();
    const out = parseLookStrict(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(typeof out).toBe("object");
    expect(Object.keys(out as object)).toEqual([...LOOK_KEYS]);
  });
  it("キーの並びが違っても通す。JSON を通した値も通す", () => {
    expect(parseLookStrict({ layout: "arc", bg: "quiet", label: "front", base: "ring", tilt: "flat", shape: "wire" })).toEqual({ shape: "wire", tilt: "flat", base: "ring", label: "front", bg: "quiet", layout: "arc" });
    expect(parseLookStrict(JSON.parse(JSON.stringify(good())))).toEqual(good());
  });
  it("パターンはすべて通る。選択肢はすべて通る", () => {
    for (const p of PATTERNS) expect(parseLookStrict({ ...p.look })).toEqual(p.look);
    for (const k of LOOK_KEYS)
      for (const v of LOOK_OPTIONS[k] as readonly string[]) expect(parseLookStrict({ ...good(), [k]: v })).toEqual({ ...good(), [k]: v });
  });
  it("足りないキーは、どれが足りなくても通さない", () => {
    for (const k of LOOK_KEYS) {
      const { [k]: _omit, ...rest } = good() as Record<LookKey, string>;
      void _omit;
      expect(typeof parseLookStrict(rest)).toBe("string");
    }
    expect(typeof parseLookStrict({})).toBe("string");
  });
  it("知らないキーは通さない(正しい 6 つに足しても)", () => {
    expect(typeof parseLookStrict({ ...good(), extra: "x" })).toBe("string");
    expect(typeof parseLookStrict({ ...good(), box: "glass" })).toBe("string");
    // 部品の名前を取り違えた 6 つ(試作の box)
    const { shape: _s, ...rest } = good();
    void _s;
    expect(typeof parseLookStrict({ ...rest, box: "glass" })).toBe("string");
  });
  it("選択肢にない値・型違いの値は通さない(部品ごと)", () => {
    for (const k of LOOK_KEYS)
      for (const bad of ["", "unknown", "Glass", " glass", "glass ", "glass\0", "GLASS", 0, 1, null, undefined, true, false, {}, [], ["glass"], { toString: () => "glass" }, Symbol("glass")])
        expect(typeof parseLookStrict({ ...good(), [k]: bad }), `${k}=${String(bad)}`).toBe("string");
    // ほかの部品の値
    expect(typeof parseLookStrict({ ...good(), shape: "flat" })).toBe("string");
  });
  it("形が違う入力は通さない: null・undefined・配列・文字列・数・真偽・関数・Map", () => {
    for (const bad of [null, undefined, [], [good()], Object.values(good()), "glass", JSON.stringify(good()), 1, true, () => good(), new Map(Object.entries(good())), new Date(0)])
      expect(typeof parseLookStrict(bad)).toBe("string");
  });
  it("`__proto__`・`constructor`・`prototype` などのキーは通さず、Object.prototype を汚さない", () => {
    const payloads = [
      '{"__proto__": {"shape": "glass"}, "tilt": "vertex", "base": "dish", "label": "below", "bg": "logo", "layout": "row"}', // 6 キーのうち 1 つが __proto__
      '{"shape": "glass", "tilt": "vertex", "base": "dish", "label": "below", "bg": "logo", "layout": "row", "__proto__": {"polluted": true}}',
      '{"constructor": {"prototype": {"polluted": true}}, "tilt": "vertex", "base": "dish", "label": "below", "bg": "logo", "layout": "row"}',
      '{"shape": "glass", "tilt": "vertex", "base": "dish", "label": "below", "bg": "logo", "layout": "row", "constructor": "x"}',
      '{"shape": "glass", "tilt": "vertex", "base": "dish", "label": "below", "bg": "logo", "layout": "row", "prototype": "x"}',
      '{"__proto__": null}',
      '{"__proto__": {}}',
    ];
    for (const p of payloads) expect(typeof parseLookStrict(JSON.parse(p)), p).toBe("string");
    expect(asRecord({}).polluted).toBeUndefined();
    expect(asRecord({}).shape).toBeUndefined();
    for (const k of ["toString", "hasOwnProperty", "valueOf", "__defineGetter__"]) expect(typeof parseLookStrict({ ...good(), [k]: "x" })).toBe("string");
  });
  it("自分のキーでない(継承した)値や、記号のキーは通さない", () => {
    expect(typeof parseLookStrict(Object.create(good()))).toBe("string");
    expect(typeof parseLookStrict({ ...good(), [Symbol("x")]: 1 })).toBe("string");
  });
  it("大きすぎる入力は通さない: キーが多い・値が長い。理由に入力の値を入れない", () => {
    const many: Record<string, string> = { ...good() };
    for (let i = 0; i < 20_000; i++) many[`k${i}`] = "glass";
    expect(typeof parseLookStrict(many)).toBe("string");
    const long = "g".repeat(1_000_000);
    const r = parseLookStrict({ ...good(), shape: long });
    expect(typeof r).toBe("string");
    expect((r as string).length).toBeLessThan(100);
    expect(r as string).not.toContain("ggg");
    const evil = parseLookStrict({ ...good(), base: "EVIL<script>alert(1)</script>" });
    expect(evil as string).not.toContain("EVIL");
    expect(parseLookStrict({ ...good(), ["EVIL-KEY"]: 1 }) as string).not.toContain("EVIL");
  });
  it("理由は、決まった日本語の文(部品名が入るときも、許可した部品名だけ)", () => {
    expect(parseLookStrict(null)).toBe("見た目の指定の形が違います");
    expect(parseLookStrict({})).toBe("見た目の指定に、知らない項目か足りない項目があります");
    expect(parseLookStrict({ ...good(), tilt: "x" })).toBe("見た目の「tilt」に選べない値があります");
  });
  it("入力を書き換えず、返した値を書き換えても入力に響かない", () => {
    const input = good();
    const copy = { ...input };
    const out = parseLookStrict(input) as Look;
    out.shape = "wire";
    expect(input).toEqual(copy);
  });
});

describe("parseLookLenient(読むとき用。ゆるく)", () => {
  it("正しい値はそのまま(新しいオブジェクト)", () => {
    const input = good();
    const out = parseLookLenient(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
  it("知らない値・型違いの値は、その部品だけ既定にする", () => {
    expect(parseLookLenient({ ...good(), shape: "unknown", base: 3 })).toEqual({ ...good(), shape: DEFAULT_LOOK.shape, base: DEFAULT_LOOK.base });
    expect(parseLookLenient({ ...good(), layout: null, bg: ["grid"] })).toEqual({ ...good(), layout: DEFAULT_LOOK.layout, bg: DEFAULT_LOOK.bg });
  });
  it("足りない部品は既定にする。{}(表の既定値)は全部既定", () => {
    const { tilt: _t, ...rest } = good();
    void _t;
    expect(parseLookLenient(rest)).toEqual({ ...good(), tilt: DEFAULT_LOOK.tilt });
    expect(parseLookLenient({})).toEqual(DEFAULT_LOOK);
  });
  it("知らないキーは捨てる", () => {
    const out = parseLookLenient({ ...good(), extra: 1, box: "glass" });
    expect(out).toEqual(good());
    expect(Object.keys(out)).toEqual([...LOOK_KEYS]);
  });
  it("形が違う入力(null・配列・文字列など)は、すべて既定", () => {
    for (const bad of [null, undefined, [], [good()], "glass", 1, true, () => 0]) expect(parseLookLenient(bad)).toEqual(DEFAULT_LOOK);
  });
  it("`__proto__`・継承した値は読まず、Object.prototype を汚さない", () => {
    const out = parseLookLenient(JSON.parse(`{"__proto__": {"shape": "wire"}, "tilt": "${good().tilt}"}`));
    expect(out).toEqual({ ...DEFAULT_LOOK, tilt: good().tilt });
    expect(asRecord({}).shape).toBeUndefined();
    expect(parseLookLenient(Object.create(good()))).toEqual(DEFAULT_LOOK);
  });
  it("返した値を書き換えても、DEFAULT_LOOK は変わらない", () => {
    const shape = DEFAULT_LOOK.shape;
    const a = parseLookLenient(undefined);
    a.shape = shape === "wire" ? "solid" : "wire";
    expect(DEFAULT_LOOK.shape).toBe(shape);
    expect(parseLookLenient(undefined).shape).toBe(shape);
  });
  it("strict を通った値は、lenient でも同じ", () => {
    for (const p of PATTERNS) expect(parseLookLenient(parseLookStrict({ ...p.look }))).toEqual(p.look);
  });
});

describe("Theme・World", () => {
  it("明暗は dark・light だけ", () => {
    expect(THEMES).toEqual(["dark", "light"]);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("light")).toBe(true);
    for (const bad of ["Dark", "auto", "", null, undefined, 0, {}]) expect(isTheme(bad)).toBe(false);
  });
  it("World は 無地(plain)だけ(P2)", () => {
    expect(WORLDS).toEqual(["plain"]);
    expect(DEFAULT_WORLD).toBe("plain");
    expect(isWorldId("plain")).toBe(true);
    for (const bad of ["modern", "Plain", "", " plain", null, undefined, 1, ["plain"], "__proto__", "constructor"]) expect(isWorldId(bad)).toBe(false);
    expect(Object.keys(WORLD_LABELS)).toEqual([...WORLDS]);
    expect(Object.keys(THEME_LABELS).sort()).toEqual([...THEMES].sort());
  });
  it("World の形は表 principal_pref の check(英小文字で始まる 32 字まで)に収まる", () => {
    for (const w of WORLDS) expect(w).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
  });
});

describe("parsePrefsPatch(PUT の本文。厳しく)", () => {
  it("theme だけ・world だけ・look だけ・3 つ、送られた欄だけを返す", () => {
    expect(parsePrefsPatch({ theme: "dark" })).toEqual({ theme: "dark" });
    expect(parsePrefsPatch({ theme: "light" })).toEqual({ theme: "light" });
    expect(parsePrefsPatch({ world: "plain" })).toEqual({ world: "plain" });
    expect(parsePrefsPatch({ look: good() })).toEqual({ look: good() });
    expect(parsePrefsPatch({ theme: "dark", world: "plain", look: good() })).toEqual({ theme: "dark", world: "plain", look: good() });
  });
  it("theme: null は「パソコンの設定に合わせる」に戻す(欄がないのとは別)", () => {
    const r = parsePrefsPatch({ theme: null });
    expect(r).toEqual({ theme: null });
    expect(Object.hasOwn(r as object, "theme")).toBe(true);
    expect(Object.hasOwn(parsePrefsPatch({ world: "plain" }) as object, "theme")).toBe(false);
  });
  it("theme は dark・light・null 以外を通さない", () => {
    for (const bad of ["Dark", "auto", "", " dark", undefined, 0, false, {}, [], ["dark"]]) expect(typeof parsePrefsPatch({ theme: bad }), String(bad)).toBe("string");
  });
  it("world は許可リスト(plain)だけ", () => {
    for (const bad of ["modern", "", "PLAIN", null, undefined, 1, {}, "__proto__", "constructor"]) expect(typeof parsePrefsPatch({ world: bad }), String(bad)).toBe("string");
  });
  it("look は厳しく(6 つの部品がそろっていなければ通さない。理由は parseLookStrict のもの)", () => {
    const { layout: _l, ...partial } = good();
    void _l;
    expect(parsePrefsPatch({ look: partial })).toBe("見た目の指定に、知らない項目か足りない項目があります");
    expect(parsePrefsPatch({ look: { ...good(), shape: "x" } })).toBe("見た目の「shape」に選べない値があります");
    expect(parsePrefsPatch({ look: null })).toBe("見た目の指定の形が違います");
    expect(parsePrefsPatch({ look: [] })).toBe("見た目の指定の形が違います");
    expect(typeof parsePrefsPatch({ theme: "dark", look: { ...good(), bg: "x" } })).toBe("string");
  });
  it("欄が 1 つもなければ通さない", () => {
    expect(parsePrefsPatch({})).toBe("更新する項目がありません");
  });
  it("知らないキーは通さない(正しい欄と一緒でも)", () => {
    for (const extra of ["foo", "Theme", "id", "principal", "updated_at", "worlds", "looks"]) expect(typeof parsePrefsPatch({ theme: "dark", [extra]: 1 }), extra).toBe("string");
    expect(typeof parsePrefsPatch({ foo: 1 })).toBe("string");
  });
  it("`__proto__`・`constructor`・`prototype` のキーは通さず、Object.prototype を汚さない", () => {
    for (const p of [
      '{"__proto__": {"theme": "dark"}}',
      '{"theme": "dark", "__proto__": {"polluted": true}}',
      '{"constructor": {"prototype": {"polluted": true}}}',
      '{"theme": "dark", "constructor": 1}',
      '{"theme": "dark", "prototype": 1}',
      '{"look": {"__proto__": {"shape": "glass"}, "tilt": "flat", "base": "dish", "label": "below", "bg": "logo", "layout": "row"}}',
    ]) expect(typeof parsePrefsPatch(JSON.parse(p)), p).toBe("string");
    expect(asRecord({}).polluted).toBeUndefined();
    expect(asRecord({}).theme).toBeUndefined();
  });
  it("形が違う入力(null・配列・文字列・数・undefined)は通さない", () => {
    for (const bad of [null, undefined, [], [{ theme: "dark" }], "theme", 1, true, () => 0, new Map([["theme", "dark"]])]) expect(parsePrefsPatch(bad)).toBe("設定の指定の形が違います");
  });
  it("継承した値・記号のキーは通さない", () => {
    expect(typeof parsePrefsPatch(Object.create({ theme: "dark" }))).toBe("string");
    expect(typeof parsePrefsPatch({ theme: "dark", [Symbol("x")]: 1 })).toBe("string");
  });
  it("理由に入力の値を入れない", () => {
    for (const bad of [{ theme: "EVIL" }, { world: "EVIL" }, { EVIL: 1 }, { look: { ...good(), shape: "EVIL" } }, { look: { EVIL: 1 } }]) expect(parsePrefsPatch(bad) as string).not.toContain("EVIL");
  });
  it("新しいオブジェクトを返し、入力を書き換えず、入力と同じ参照を持たない", () => {
    const look = good();
    const input = { theme: "dark", world: "plain", look };
    const copy = JSON.parse(JSON.stringify(input));
    const out = parsePrefsPatch(input) as { look: Look };
    expect(input).toEqual(copy);
    expect(out).not.toBe(input);
    expect(out.look).not.toBe(look);
    out.look.shape = "wire";
    expect(look.shape).toBe(good().shape);
  });
  it("返すのは theme・world・look のうち送られたものだけ(順は固定)", () => {
    const out = parsePrefsPatch({ look: good(), world: "plain", theme: null });
    expect(Object.keys(out as object)).toEqual(["theme", "world", "look"]);
  });
});

describe("parsePrefsLenient・defaultPrefs(読むとき用)", () => {
  it("何も覚えていなければ既定(theme: null、world: plain、look: パターン 3)", () => {
    expect(defaultPrefs()).toEqual({ theme: null, world: "plain", look: DEFAULT_LOOK });
    expect(parsePrefsLenient(undefined)).toEqual(defaultPrefs());
    expect(parsePrefsLenient(null)).toEqual(defaultPrefs());
    expect(parsePrefsLenient({})).toEqual(defaultPrefs());
    expect(parsePrefsLenient({ theme: null, world: "plain", look: {} })).toEqual(defaultPrefs()); // 表の既定の行
  });
  it("正しい値はそのまま", () => {
    expect(parsePrefsLenient({ theme: "dark", world: "plain", look: good() })).toEqual({ theme: "dark", world: "plain", look: good() });
    expect(parsePrefsLenient({ theme: "light", world: "plain", look: good() }).theme).toBe("light");
  });
  it("知らない値は、その欄だけ既定にする", () => {
    expect(parsePrefsLenient({ theme: "auto", world: "modern", look: { ...good(), shape: "x" } })).toEqual({ theme: null, world: "plain", look: { ...good(), shape: DEFAULT_LOOK.shape } });
  });
  it("形が違う入力(配列・文字列など)は既定", () => {
    for (const bad of [[], "x", 1, true]) expect(parsePrefsLenient(bad)).toEqual(defaultPrefs());
  });
  it("defaultPrefs はいつも新しいオブジェクトで、書き換えても既定に響かない", () => {
    const a = defaultPrefs();
    a.look.shape = DEFAULT_LOOK.shape === "wire" ? "solid" : "wire";
    a.theme = "dark";
    expect(defaultPrefs().look.shape).toBe(DEFAULT_LOOK.shape);
    expect(defaultPrefs().theme).toBeNull();
    expect(defaultPrefs()).not.toBe(defaultPrefs());
    expect(defaultPrefs().look).not.toBe(DEFAULT_LOOK);
  });
});
