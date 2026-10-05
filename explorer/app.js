// 入金キューブ(公開版)。データは /api/deposit/data から読み込む。
// 行の app・con・corp・shop にはコードを入れ、画面には名前を出す(同じ名前の法人があっても混ざらないように)
(async () => {
const $ = id => document.getElementById(id);
let DATA;
try {
  const res = await fetch("/api/deposit/data", { cache: "no-store" });
  if (res.status === 401) { location.href = "/login"; return; }
  if (!res.ok) throw new Error(await res.text());
  DATA = await res.json();
} catch (e) {
  $("app-status").hidden = false;
  $("app-status").textContent = "データを読み込めませんでした:" + e.message;
  return;
}
if (!DATA.deposits.length) {
  $("app-status").hidden = false;
  $("app-status").innerHTML = '入金明細がまだありません。<a href="/import">取り込み画面</a>から CSV・Excel を入れてください。';
  document.querySelector(".wrap").classList.add("is-empty");
  return;
}
$("app-status").hidden = true;

const NAMES = { app: new Map(), con: new Map(), corp: new Map(), shop: new Map() };
const byCode = list => new Map(list.map(x => [x.code, x]));
const apps = byCode(DATA.applicants), cons = byCode(DATA.contractors), corps = byCode(DATA.companies), shops = byCode(DATA.shops);
for (const [k, m] of [["app", apps], ["con", cons], ["corp", corps], ["shop", shops]]) for (const x of m.values()) NAMES[k].set(x.code, x.name);

// 明細1行 = ショップ × 月 × 内訳。上の階層をたどって行に持たせる
const ROWS = [];
for (const d of DATA.deposits) {
  const s = shops.get(d.shop_code), c = s && corps.get(s.company_code), k = c && cons.get(c.contractor_code), a = k && apps.get(k.applicant_code);
  if (!a) continue;
  ROWS.push({ app: a.code, con: k.code, corp: c.code, tax: c.tax_category, mall: s.mall, shop: s.code, month: d.month, item: d.item, amt: Number(d.amount) });
}
const uniq = xs => [...new Set(xs)];
const MONTHS = uniq(ROWS.map(r => r.month)).sort();
const ITEMS = uniq(["売上", ...ROWS.map(r => r.item)]).filter(i => ROWS.some(r => r.item === i));
const ORDER = { tax: ["課税", "免税"], mall: uniq(DATA.shops.map(s => s.mall)), month: MONTHS, item: ITEMS, app: [], con: [], corp: [], shop: [] };

// 申込者 › 契約者 › 法人 › ショップ の木
const kidsOf = (list, key, parent) => list.filter(x => x[key] === parent);
const TREE = DATA.applicants.map(a => ({
  label: a.name, axis: "app", key: a.code, src: a,
  children: kidsOf(DATA.contractors, "applicant_code", a.code).map(k => ({
    label: k.name, axis: "con", key: k.code, src: k,
    children: kidsOf(DATA.companies, "contractor_code", k.code).map(c => ({
      label: c.name, axis: "corp", key: c.code, tax: c.tax_category, src: c,
      children: kidsOf(DATA.shops, "company_code", c.code).map(s => ({ label: s.name, axis: "shop", key: s.code, mall: s.mall, src: s, children: [] })),
    })),
  })),
}));
const walk = (nodes, f) => nodes.forEach(n => { f(n); walk(n.children, f); });
walk(TREE, n => ORDER[n.axis].push(n.key));

// ── 入れ子:キューブの中のキューブ ─────────────────────────
// 種類は3つ。入れ物(box)=中にキューブを並べるだけ。情報カード(card)=軸のない1件の情報。
// データのキューブ(cube)=3軸で集計できるもの。入れ物の中のキューブどうしは連動しない。
const NEST = new Map();
let nid = 0;
const nn = n => { n.id = "n" + nid++; NEST.set(n.id, n); n.kids = n.kids || []; n.kids.forEach(k => { k.parent = n.id; }); return n; };
const card = (label, fields) => nn({ kind: "card", label, fields: fields.filter(([, v]) => v !== null && v !== undefined && v !== "") });
const box = (label, sub, kids, extra = {}) => nn({ kind: "box", label, sub, kids, ...extra });
const extraFields = x => Object.entries(x.extra || {}).map(([k, v]) => [k, String(v)]);
const ymd = d => (d ? `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : "");

const nestShop = (app, con, corp, s) => box(s.label, `${s.mall}のショップ`, [
  card("ショップ情報", [["コード", s.key], ["モール", s.mall], ...extraFields(s.src)]),
  nn({ kind: "cube", label: "月別の入金", keys: { app, con, corp, shop: s.key }, mall: s.mall }),
], { keys: { app, con, corp, shop: s.key } });

const nestCorp = (app, con, c) => box(c.label, "法人", [
  card("法人の基本情報", [["コード", c.key], ["郵便番号", c.src.postal_code], ["住所", c.src.address], ["代表者", c.src.representative],
    ["設立", ymd(c.src.founded_on)], ["課税区分", `${c.tax}事業者`], ["インボイス登録番号", c.src.invoice_no], ...extraFields(c.src)]),
  box("ショップ", "入れ物", c.children.map(s => nestShop(app, con, c.key, s))),
], { tax: c.tax, keys: { app, con, corp: c.key } });

const nestCon = (app, c) => box(c.label, "契約者", [
  card("契約者の基本情報", [["コード", c.key], ...extraFields(c.src)]),
  box("法人", "入れ物", c.children.map(x => nestCorp(app, c.key, x))),
], { keys: { app, con: c.key } });

const nestApp = a => box(a.label, "申込者", [
  card("申込者の基本情報", [["コード", a.key], ...extraFields(a.src)]),
  box("契約者", "入れ物", a.children.map(c => nestCon(a.key, c))),
], { keys: { app: a.key } });

const NEST_ROOT = box("申込者", "いちばん外側の入れ物", TREE.map(nestApp));

// ── 軸 ─────────────────────────────────────────────
const AXES = {
  tax: { label: "課税区分" }, app: { label: "申込者" }, con: { label: "契約者" }, corp: { label: "法人" },
  mall: { label: "モール" }, shop: { label: "ショップ" }, month: { label: "年月" }, item: { label: "内訳項目" },
};
for (const [k, a] of Object.entries(AXES)) {
  a.key = r => r[k];
  a.name = m => (k === "month" ? `${m.slice(0, 4)}年${Number(m.slice(5))}月` : NAMES[k]?.get(m) ?? m);
}
const fmt = v => (v < 0 ? "−¥" : "¥") + Math.abs(Math.round(v)).toLocaleString("ja-JP");

// ── 状態:絞り込みは左から順に重なる ─────────────────────────
const st = {
  filters: [], // 自分でかけたフィルター { axis, value }。かけたときだけ閲覧範囲が狭まる
  path: [],    // 潜っている場所 { axis, value }。ラベルやコマから潜るだけで、閲覧範囲は狭めない
  row: "corp", col: "mall", depth: "month",
  mode: "aggregate", slice: null, sel: null,
  view: "cube", // 見せ方:cube=立体(3軸)、sheet=シート(2軸)
  nest: [NEST_ROOT.id], nestCard: null, nestSel: null, // 入れ子でいまいる場所と、開いている情報カード
};

let lastRC = null; // いま表に出している行・列(見出しのクリックで使う)
const filterRows = () => ROWS.filter(r => st.filters.every(f => r[f.axis] === f.value));
const visibleRows = () => filterRows().filter(r => st.path.every(f => r[f.axis] === f.value));
const membersOf = (axis, rows) => {
  const have = new Set(rows.map(r => r[axis]));
  return ORDER[axis].filter(m => have.has(m));
};
// その軸が1つの値に決まっているか(フィルターでも、潜った場所でも)
const filtered = axis => st.filters.some(f => f.axis === axis) || st.path.some(f => f.axis === axis);

function setTax(value) {
  st.filters = st.filters.filter(f => f.axis !== "tax");
  if (value) st.filters.unshift({ axis: "tax", value });
  afterFilterChange();
}

/** 絞り込みが変わったら、外れた軸や消えた選択を直す */
function afterFilterChange() {
  const rows = visibleRows();
  const usable = Object.keys(AXES).filter(a => !filtered(a));
  for (const slot of ["row", "col", "depth"]) {
    if (filtered(st[slot])) st[slot] = usable.find(a => ![st.row, st.col, st.depth].includes(a)) || st[slot];
  }
  if (st.mode === "slice" && !membersOf(st.depth, rows).includes(st.slice)) st.slice = membersOf(st.depth, rows)[0] ?? null;
  const R = membersOf(st.row, rows), C = membersOf(st.col, rows);
  if (st.sel && (!R.includes(st.sel[0]) || !C.includes(st.sel[1]))) st.sel = null;
  render();
}

/** 潜る:選んだコマの座標を絞り込みに足し、内側の立体の軸に切り替える */
/** 潜る:いまの軸の組み合わせを覚えておき(戻ったときに元の見え方に戻すため)、場所を足す */
function dive(steps) {
  diveOuter(steps, false);
}
/** 外側の立体から潜る:同じ軸の場所は置き換え、ほかは足す(最初に潜ったときの軸の組み合わせは保つ) */
function diveOuter(steps, fresh) {
  const prev = st.path.length ? st.path[0].prev : { row: st.row, col: st.col, depth: st.depth };
  const base = fresh ? [] : st.path.map(f => ({ axis: f.axis, value: f.value }));
  for (const s of steps) {
    const i = base.findIndex(f => f.axis === s.axis);
    if (i >= 0) base[i] = s; else base.push(s);
  }
  if (!base.length) return;
  base[0].prev = prev;
  st.path = base;
  reaxis();
}
// 立体はいつも外側(最初に潜る前)の軸で描き、潜った場所はズームして周りを半透明にする
const outerAxes = () => (st.path.length ? st.path[0].prev : null);

function backTo(level) {
  const step = st.path[level];
  st.path = st.path.slice(0, level);
  if (step && step.prev) { Object.assign(st, step.prev, { mode: "aggregate", slice: null, sel: null }); render(); }
  else reaxis();
}

function drill() {
  if (!st.sel) return;
  dive([{ axis: st.row, value: st.sel[0] }, { axis: st.col, value: st.sel[1] }, ...(st.mode === "slice" ? [{ axis: st.depth, value: st.slice }] : [])]);
}

/** 絞り込みを足したあと、まだ値が分かれている軸から内側の立体(またはシート)の軸を選ぶ */
function reaxis() {
  const rows = visibleRows();
  const varies = a => !filtered(a) && membersOf(a, rows).length > 1;
  const rest = Object.keys(AXES).filter(a => !filtered(a));
  const rowAxis = ["app", "con", "corp", "shop", "mall"].find(varies) ?? (varies("item") ? "item" : rest[0]);
  // 分かれている軸が1つしかないときは、最後に潜った値(例:2025年10月)を列の見出しにする
  const lastAxis = [...st.path].reverse().map(f => f.axis).find(a => a !== rowAxis && a !== "tax");
  const colAxis = ["month", "item"].find(a => a !== rowAxis && varies(a)) ?? lastAxis ?? rest.find(a => a !== rowAxis);
  const depthAxis = ["item", "month", "mall", "shop", "corp", "con", "app", "tax"].find(a => ![rowAxis, colAxis].includes(a) && varies(a))
    ?? ["shop", "mall", "corp", "con", "app", "tax"].find(a => ![rowAxis, colAxis].includes(a) && !filtered(a))
    ?? rest.find(a => ![rowAxis, colAxis].includes(a))
    ?? Object.keys(AXES).find(a => ![rowAxis, colAxis].includes(a));
  Object.assign(st, { row: rowAxis, col: colAxis, depth: depthAxis, mode: "aggregate", slice: null, sel: null });
  render();
}

/** 軸のラベルをタップ:その値に潜る */
function enterAxisMember(slot, value) {
  dive([{ axis: st[slot], value }]);
}

/** 立体のコマをダブルクリック:そのコマ(行・列・奥行きの1点)の中に入る */
function enterCell(r, c, z) {
  dive([{ axis: st.row, value: r }, { axis: st.col, value: c }, ...(z !== undefined ? [{ axis: st.depth, value: z }] : [])]);
}

function setAxis(slot, val) {
  const other = ["row", "col", "depth"].find(s => s !== slot && st[s] === val);
  if (other) st[other] = st[slot];
  st[slot] = val;
  st.slice = null; st.sel = null;
  if (st.mode === "slice") st.slice = membersOf(st.depth, visibleRows())[0] ?? null;
  render();
}

// ── 描画 ─────────────────────────────────────────────
function render() {
  const rows = visibleRows();
  const fRows = filterRows();
  renderFilters(fRows);
  renderNest();
  renderTree(fRows);
  renderControls(rows);

  const R = { ...AXES[st.row], members: membersOf(st.row, rows) };
  const C = { ...AXES[st.col], members: membersOf(st.col, rows) };
  const Z = { ...AXES[st.depth], members: membersOf(st.depth, rows) };
  const itemsIn = st.row === "item" || st.col === "item" || (st.depth === "item" && st.mode === "slice") || filtered("item");
  const measure = itemsIn ? "金額" : "入金額(売上 − 費用)";
  const asSheet = st.view === "sheet";
  const usedAxes = asSheet ? [st.row, st.col] : [st.row, st.col, st.depth];
  const unused = Object.keys(AXES).filter(a => !usedAxes.includes(a) && !filtered(a)).map(a => AXES[a].label);
  $("unused-note").textContent = unused.length ? `${asSheet ? "シートは2軸" : "立体は3軸"}です。使っていない軸(${unused.join("・")})は全部まとめて集計しています。行・列の見出しをクリックすると、その中に潜れます。` : "行・列の見出しをクリックすると、その中に潜れます。";
  $("face-title").textContent = asSheet ? `${R.label} × ${C.label} ／ ${measure}` : `${R.label} × ${C.label} ／ 奥行き:${Z.label}を` +
    (st.mode === "aggregate" ? "集約" : `「${Z.name(st.slice)}」で断面`) + ` ／ ${measure}`;
  lastRC = { row: R, col: C };

  // 面
  const face = new Map();
  for (const r of rows) {
    if (st.mode === "slice" && r[st.depth] !== st.slice) continue;
    const k = r[st.row] + "|" + r[st.col];
    face.set(k, (face.get(k) || 0) + r.amt);
  }
  let max = 0;
  for (const v of face.values()) max = Math.max(max, Math.abs(v));
  if (!R.members.length) {
    $("face").innerHTML = `<tr><td class="empty-msg">${st.path.length && st.filters.length ? "いま潜っている場所は、かけているフィルターで外れています。フィルターを外すか、上の「潜っている場所」で外側へ戻ってください。" : "当てはまるデータはありません。"}</td></tr>`;
  } else {
    // 見出しはクリックでその値に潜れる
    const hdr = (slot, A, m, i) => `<button type="button" class="hdr" data-slot="${slot}" data-i="${i}" title="クリックで「${A.name(m)}」の中へ">${A.name(m)}</button>`;
    let h = `<thead><tr><th>${R.label} \\ ${C.label}</th>` + C.members.map((m, i) => `<th>${hdr("col", C, m, i)}</th>`).join("") + `<th>計</th></tr></thead><tbody>`;
    const colTot = new Map(); let all = 0;
    for (const [ri, r] of R.members.entries()) {
      let rowTot = 0;
      h += `<tr><th>${hdr("row", R, r, ri)}</th>`;
      for (const c of C.members) {
        const v = face.get(r + "|" + c);
        const sel = st.sel && st.sel[0] === r && st.sel[1] === c ? " sel" : "";
        if (v === undefined) { h += `<td class="empty${sel}" tabindex="0" data-r="${r}" data-c="${c}">—</td>`; continue; }
        rowTot += v; colTot.set(c, (colTot.get(c) || 0) + v); all += v;
        const heat = `background: rgba(var(--heat), calc(var(--heat-max) * ${(Math.abs(v) / max).toFixed(3)}))`;
        h += `<td class="${sel}${v < 0 ? " neg" : ""}" tabindex="0" data-r="${r}" data-c="${c}" style="${heat}">${fmt(v)}</td>`;
      }
      h += `<td class="total">${fmt(rowTot)}</td></tr>`;
    }
    h += `<tr><th class="total">計</th>` + C.members.map(c => `<td class="total">${colTot.has(c) ? fmt(colTot.get(c)) : "—"}</td>`).join("") + `<td class="total">${fmt(all)}</td></tr></tbody>`;
    $("face").innerHTML = h;
  }
  renderCell(rows, R, C, Z, face);
  // 奥行きが1層しかない=中身が2軸なら、立体にせずシート(表)で見せる
  const none = !R.members.length || !C.members.length;
  const sheet = none || asSheet || (Z.members.length <= 1 && !outerAxes());
  $("cube-panel").classList.toggle("is-sheet", sheet);
  $("sheet-note").hidden = !sheet;
  if (none) $("sheet-note").innerHTML = "いま潜っている場所は、かけているフィルターで外れています。フィルターを外すか、「潜っている場所」で外側へ戻ってください。";
  else if (asSheet) $("sheet-note").innerHTML = `シート(2軸)で「${R.label} × ${C.label}」を表示しています。下の表の行・列の見出しをクリックすると、その中に潜れます。` +
    `<br>立体に戻すには、上の「見せ方」で「立体(3軸)」を選んでください。`;
  else if (sheet) $("sheet-note").innerHTML = `ここから先は「${R.label} × ${C.label}」の2軸だけなので、立体ではなく下のシート(表)で表示しています。` +
    `<br>上の「潜っている場所」で外側へ戻れます。`;
  const outer = outerAxes();
  if (!sheet && outer) Cube3D.update(build3dOuter(outer, rows));
  else if (!sheet && R.members.length && C.members.length && Z.members.length) Cube3D.update(build3d(rows, R, C, Z));
  $("focus-note").hidden = sheet || !outer;
  if (outer) $("focus-note").textContent = `立体は外側(${AXES[outer.row].label} × ${AXES[outer.col].label} × ${AXES[outer.depth].label})のまま、潜っている場所を拡大し、周りを半透明にしています。中身は下の表で見られます。半透明のコマもダブルクリックでそこへ移れます。`;
  if (outer) $("legend-mode").textContent = "";
  else $("legend-mode").textContent = st.mode === "aggregate"
    ? `奥行き(${Z.label})を正面へまとめた値が表に出ています。`
    : `奥行き(${Z.label})の「${Z.name(st.slice)}」の層だけを表に出しています。`;
}

const KIND_NAME = { box: "入れ物", card: "情報カード", cube: "データのキューブ(3軸)" };
const KIND_ICON = { box: "ki-box", card: "ki-card", cube: "ki-cube" };

function renderNest() {
  const tax = st.filters.find(f => f.axis === "tax")?.value;
  const rowsOf = keys => ROWS.filter(r => Object.entries(keys).every(([k, v]) => r[k] === v));
  // 課税区分のフィルターで外れているか(中にあてはまる法人が1つもない)
  const isOut = n => {
    if (!tax) return false;
    if (n.tax) return n.tax !== tax;
    if (n.kind === "card") return false;
    if (n.kind === "cube") return rowsOf(n.keys).every(r => r.tax !== tax);
    return n.kids.length > 0 && n.kids.filter(k => k.kind !== "card").every(isOut);
  };
  const cur = NEST.get(st.nest[st.nest.length - 1]);
  $("nest-crumbs").innerHTML = st.nest.map((id, i) => {
    const n = NEST.get(id);
    return i === st.nest.length - 1 ? `<span class="here">${n.label}</span>` : `<button type="button" data-crumb="${i}">${n.label}</button><span class="sep">›</span>`;
  }).join("");

  const count = n => {
    const c = { box: 0, card: 0, cube: 0 };
    n.kids.forEach(k => c[k.kind]++);
    return [c.card && `情報カード ${c.card}`, c.box && `入れ物 ${c.box}`, c.cube && `データのキューブ ${c.cube}`].filter(Boolean).join("・");
  };
  $("nest-tiles").innerHTML = cur.kids.map(n => {
    const out = isOut(n);
    let sub;
    if (n.kind === "card") sub = `${n.fields.length}項目・軸なし(この1件で完結)`;
    else if (n.kind === "cube") {
      const total = rowsOf(n.keys).reduce((a, r) => a + r.amt, 0);
      sub = `年月 × 内訳項目 × モール<br>12か月の入金計 ${fmt(total)}`;
    } else {
      const names = n.kids.filter(k => k.kind === "box").map(k => k.label);
      sub = n.sub === "入れ物" ? `中身:${names.length}個のキューブ` : `${n.sub}・中身:${count(n)}`;
      if (n.tax) sub += ` <span class="badge ${n.tax === "課税" ? "t" : "f"}">${n.tax}</span>`;
    }
    if (out) sub += "<br>課税区分のフィルターで外れています";
    const open = (n.kind === "card" && st.nestCard === n.id) || st.nestSel === n.id ? " open" : "";
    return `<button type="button" class="tile ${n.kind}${out ? " out" : ""}${open}" data-node="${n.id}">` +
      `<span class="k"><i class="ki ${KIND_ICON[n.kind]}"></i>${KIND_NAME[n.kind]}</span><span class="t">${n.label}</span><span class="s">${sub}</span></button>`;
  }).join("");

  const boxes = cur.kids.filter(k => k.kind === "box");
  const shops = boxes.length > 1 && boxes.every(k => k.keys?.shop);
  $("nest-note").textContent = shops
    ? "それぞれのショップは別々のキューブです。楽天とYahoo!は互いに連動しません。数字を見るには、ショップを開いて「月別の入金」を選んでください。"
    : cur.kids.some(k => k.kind === "card")
      ? `「${cur.label}」の中の情報カードと入れ物は独立しています。3軸で連動するのは、データのキューブの中だけです。`
      : `「${cur.label}」は入れ物です。中のキューブを並べているだけで、互いに連動しません。`;

  const how = "キューブは1回タップで選び、ダブルクリック(ダブルタップ)で中に入ります。";
  const picked = st.nestSel && NEST.get(st.nestSel);
  $("nest-note").textContent += " " + (picked && picked.parent === cur.id && picked.kind !== "card"
    ? `「${picked.label}」を選んでいます。ダブルクリックで中に入ります。` : how);
  const c = st.nestCard && NEST.get(st.nestCard);
  $("nest-card").hidden = !c || c.parent !== cur.id;
  if (c && c.parent === cur.id) {
    $("nest-card").innerHTML = `<h3>${cur.label} ／ ${c.label}</h3><dl>${c.fields.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` +
      `<p class="note" style="margin:8px 0 0">情報カードには軸がありません。立体にはならず、この1件の情報だけを表示します。</p>`;
  }
}

/** データのキューブを開く:そこまでの入れ子を絞り込みに積み、下の立体で表示する */
function openNestCube(n) {
  const prev = st.path.length ? st.path[0].prev : { row: st.row, col: st.col, depth: st.depth };
  st.path = Object.entries(n.keys).map(([axis, value]) => ({ axis, value }));
  st.path[0].prev = prev;
  Object.assign(st, { row: "item", col: "month", depth: "mall", mode: "aggregate", slice: null, sel: null });
  render();
  const panel = $("cube-panel");
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
  panel.classList.remove("flash"); void panel.offsetWidth; panel.classList.add("flash");
}

function renderFilters(rows) {
  const tax = st.filters.find(f => f.axis === "tax")?.value ?? "";
  document.querySelectorAll("[data-tax]").forEach(b => b.setAttribute("aria-pressed", b.dataset.tax === tax));
  // 潜っている場所:クリックでそこまで戻る
  let h = `<button type="button" class="chip root" data-level="0">全体</button>`;
  st.path.forEach((f, i) => {
    h += `<span class="sep">›</span>` + (i === st.path.length - 1
      ? `<span class="chip here">${AXES[f.axis].label}:${AXES[f.axis].name(f.value)}</span>`
      : `<button type="button" class="chip root" data-level="${i + 1}" title="ここまで戻る">${AXES[f.axis].label}:${AXES[f.axis].name(f.value)}</button>`);
  });
  $("path").innerHTML = h;
  // フィルター:自分でかけたものだけ。× で外せる
  $("filters").innerHTML = st.filters.length ? st.filters.map((f, i) =>
    `<span class="chip">${AXES[f.axis].label}:${AXES[f.axis].name(f.value)}<button type="button" data-remove="${i}" aria-label="${AXES[f.axis].label}のフィルターを外す">×</button></span>`).join("")
    : `<span class="note">なし(全件を閲覧できます)</span>`;
  const count = (axis, all) => `${AXES[axis].label} <b>${membersOf(axis, rows).length}</b> / ${all}`;
  $("summary").innerHTML = `閲覧範囲:${count("corp", ORDER.corp.length)}社 ・ ${count("shop", ORDER.shop.length)}店 ・ 明細 <b>${rows.length.toLocaleString()}</b> / ${ROWS.length.toLocaleString()}件`;
}
function renderTree(rows) {
  const inSet = { app: new Set(), con: new Set(), corp: new Set(), shop: new Set() };
  for (const r of rows) for (const k of Object.keys(inSet)) inSet[k].add(r[k]);
  const node = n => {
    const on = inSet[n.axis].has(n.key);
    const here = st.path.some(f => f.axis === n.axis && f.value === n.key);
    const badge = n.tax ? `<span class="badge ${n.tax === "課税" ? "t" : "f"}">${n.tax}</span>` : "";
    const kids = n.children.length ? `<ul>${n.children.map(node).join("")}</ul>` : "";
    return `<li class="${on ? "in" : "out"}"><span class="${here ? "here" : ""}">${n.label}</span>${badge}${kids}</li>`;
  };
  $("tree").innerHTML = `<ul>${TREE.map(node).join("")}</ul>`;
}

function renderControls(rows) {
  const usable = Object.keys(AXES).filter(a => !filtered(a) || [st.row, st.col, st.depth].includes(a));
  for (const [id, slot] of [["ax-row", "row"], ["ax-col", "col"], ["ax-depth", "depth"]]) {
    $(id).innerHTML = usable.map(k => `<option value="${k}">${AXES[k].label}</option>`).join("");
    $(id).value = st[slot];
  }
  $("view-cube").setAttribute("aria-pressed", st.view === "cube");
  $("view-sheet").setAttribute("aria-pressed", st.view === "sheet");
  $("controls").classList.toggle("view-sheet", st.view === "sheet");
  $("mode-agg").setAttribute("aria-pressed", st.mode === "aggregate");
  $("mode-slice").setAttribute("aria-pressed", st.mode === "slice");
  $("slice-wrap").hidden = st.mode !== "slice";
  if (st.mode === "slice") {
    const zs = membersOf(st.depth, rows);
    $("slice-member").innerHTML = zs.map(m => `<option value="${m}">${AXES[st.depth].name(m)}</option>`).join("");
    $("slice-member").value = st.slice;
  }
}

function renderCell(rows, R, C, Z, face) {
  if (!st.sel) { $("cell-empty").hidden = false; $("cell-body").hidden = true; return; }
  $("cell-empty").hidden = true; $("cell-body").hidden = false;
  const [r, c] = st.sel;
  const tag = (a, m) => `<span class="axis-tag">${a.label}: ${a.name(m)}</span>`;
  $("cell-coord").innerHTML = tag(R, r) + tag(C, c) + (st.view === "sheet" ? "" : st.mode === "slice" ? tag(Z, st.slice) : `<span class="axis-tag">${Z.label}: すべて(集約)</span>`);
  const v = face.get(r + "|" + c);
  $("cell-value").textContent = v === undefined ? "—" : fmt(v);
  // 内訳(内訳項目を軸に使っていないときだけ)
  if ([st.row, st.col].includes("item") || filtered("item") || (st.mode === "slice" && st.depth === "item")) {
    $("cell-breakdown").innerHTML = "";
  } else {
    const by = new Map();
    for (const x of rows) {
      if (x[st.row] !== r || x[st.col] !== c || (st.mode === "slice" && x[st.depth] !== st.slice)) continue;
      by.set(x.item, (by.get(x.item) || 0) + x.amt);
    }
    $("cell-breakdown").innerHTML = "内訳:" + ITEMS.filter(i => by.has(i)).map(i => `${i} ${fmt(by.get(i))}`).join(" / ");
  }
  const canDrill = Object.keys(AXES).some(a => !filtered(a) && ![st.row, st.col].includes(a) && membersOf(a, rows.filter(x => x[st.row] === r && x[st.col] === c)).length > 1);
  $("drill").disabled = v === undefined || !canDrill;
  $("drill").textContent = canDrill ? "このコマに潜る" : "これ以上は潜れません(1件単位です)";
}

function build3dOuter(o, inRows) {
  const all = filterRows();
  const R = { ...AXES[o.row], members: membersOf(o.row, all) };
  const C = { ...AXES[o.col], members: membersOf(o.col, all) };
  const Z = { ...AXES[o.depth], members: membersOf(o.depth, all) };
  const idx = a => new Map(a.members.map((m, i) => [m, i]));
  const ri = idx(R), ci = idx(C), zi = idx(Z);
  const acc = new Map();
  for (const x of all) {
    const k = x[o.row] + "|" + x[o.col] + "|" + x[o.depth];
    acc.set(k, (acc.get(k) || 0) + x.amt);
  }
  let max = 0;
  const items = [...acc].map(([k, raw]) => {
    const [r, c, z] = k.split("|");
    max = Math.max(max, Math.abs(raw));
    return { r: ri.get(r), c: ci.get(c), k: zi.get(z), v: Math.abs(raw), raw };
  });
  // 潜っている場所に入るコマ
  const inKeys = new Set(inRows.map(x => ri.get(x[o.row]) + "|" + ci.get(x[o.col]) + "|" + zi.get(x[o.depth])));
  const box = { r0: Infinity, r1: -Infinity, c0: Infinity, c1: -Infinity, k0: Infinity, k1: -Infinity };
  for (const key of inKeys) {
    const [r, c, k] = key.split("|").map(Number);
    box.r0 = Math.min(box.r0, r); box.r1 = Math.max(box.r1, r); box.c0 = Math.min(box.c0, c); box.c1 = Math.max(box.c1, c);
    box.k0 = Math.min(box.k0, k); box.k1 = Math.max(box.k1, k);
  }
  const has = it => inKeys.has(it.r + "|" + it.c + "|" + it.k);
  const pathKey = st.path.map(f => f.axis + "=" + f.value).join(",");
  return {
    R, C, Z, items, max, mode: "aggregate", sliceK: null, sel: null,
    measure: "outer:" + st.filters.length + ":" + pathKey,
    focus: inKeys.size ? { has, box, key: st.filters.map(f => f.value).join(",") + "/" + pathKey } : null,
    isActive: () => true,
    onPick: () => {},
    canEnter: () => true,
    // ダブルクリック:潜っている場所の中のコマならさらに中へ、外の(半透明の)コマならそこへ移る
    onEnter: it => diveOuter([{ axis: o.row, value: R.members[it.r] }, { axis: o.col, value: C.members[it.c] }, { axis: o.depth, value: Z.members[it.k] }], !has(it)),
    onAxisPick: (dir, i) => {
      const slot = { y: "row", x: "col", z: "depth" }[dir];
      diveOuter([{ axis: o[slot], value: { row: R, col: C, depth: Z }[slot].members[i] }], false);
    },
    describe: it => `${R.name(R.members[it.r])} × ${C.name(C.members[it.c])} × ${Z.name(Z.members[it.k])}:${fmt(it.raw)}`,
  };
}

function build3d(rows, R, C, Z) {
  const idx = a => new Map(a.members.map((m, i) => [m, i]));
  const ri = idx(R), ci = idx(C), zi = idx(Z);
  const acc = new Map();
  for (const x of rows) {
    const k = x[st.row] + "|" + x[st.col] + "|" + x[st.depth];
    acc.set(k, (acc.get(k) || 0) + x.amt);
  }
  let max = 0;
  const items = [...acc].map(([k, raw]) => {
    const [r, c, z] = k.split("|");
    max = Math.max(max, Math.abs(raw));
    return { r: ri.get(r), c: ci.get(c), k: zi.get(z), v: Math.abs(raw), raw };
  });
  const sliceK = st.mode === "slice" ? zi.get(st.slice) : null;
  const canEnter = it => {
    const r = R.members[it.r], c = C.members[it.c], z = Z.members[it.k];
    const inside = rows.filter(x => x[st.row] === r && x[st.col] === c && x[st.depth] === z);
    return Object.keys(AXES).some(a => ![st.row, st.col, st.depth].includes(a) && !filtered(a) && membersOf(a, inside).length > 1);
  };
  return {
    R, C, Z, items, max, mode: st.mode, sliceK, measure: st.filters.length + ":" + st.path.length + ":" + rows.length,
    sel: st.sel ? { r: ri.get(st.sel[0]), c: ci.get(st.sel[1]) } : null,
    isActive: it => st.mode === "aggregate" || it.k === sliceK,
    onPick: it => {
      st.sel = [R.members[it.r], C.members[it.c]];
      if (st.mode === "slice") st.slice = Z.members[it.k];
      render();
    },
    describe: it => `${R.name(R.members[it.r])} × ${C.name(C.members[it.c])} × ${Z.name(Z.members[it.k])}:${fmt(it.raw)}`,
    onAxisPick: (dir, i) => {
      const slot = { y: "row", x: "col", z: "depth" }[dir];
      enterAxisMember(slot, { row: R, col: C, depth: Z }[slot].members[i]);
    },
    canEnter,
    onEnter: it => {
      const r = R.members[it.r], c = C.members[it.c], z = Z.members[it.k];
      // 中に分かれているものがなければ入らず、選ぶだけにする
      if (canEnter(it)) enterCell(r, c, z);
      else { st.sel = [r, c]; if (st.mode === "slice") st.slice = z; render(); }
    },
  };
}

// ── 操作 ─────────────────────────────────────────────
document.querySelectorAll("[data-tax]").forEach(b => b.addEventListener("click", () => setTax(b.dataset.tax)));
$("filters").addEventListener("click", e => {
  const rm = e.target.closest("[data-remove]");
  if (rm) { st.filters.splice(Number(rm.dataset.remove), 1); afterFilterChange(); }
});
$("path").addEventListener("click", e => {
  const lv = e.target.closest("[data-level]");
  if (lv) backTo(Number(lv.dataset.level));
});
$("ax-row").onchange = e => setAxis("row", e.target.value);
$("ax-col").onchange = e => setAxis("col", e.target.value);
$("ax-depth").onchange = e => setAxis("depth", e.target.value);
$("swap-rc").onclick = () => { [st.row, st.col] = [st.col, st.row]; st.sel = null; render(); };
$("swap-cd").onclick = () => { [st.col, st.depth] = [st.depth, st.col]; st.mode = "aggregate"; st.slice = null; st.sel = null; render(); };
$("mode-agg").onclick = () => { st.mode = "aggregate"; render(); };
$("mode-slice").onclick = () => { st.mode = "slice"; st.slice = st.slice ?? membersOf(st.depth, visibleRows())[0]; render(); };
$("slice-member").onchange = e => { st.slice = e.target.value; render(); };
$("nest-crumbs").addEventListener("click", e => {
  const b = e.target.closest("[data-crumb]");
  if (b) { st.nest = st.nest.slice(0, Number(b.dataset.crumb) + 1); st.nestCard = null; st.nestSel = null; renderNest(); }
});
$("nest-tiles").addEventListener("click", e => {
  const t = e.target.closest("[data-node]");
  if (!t) return;
  const n = NEST.get(t.dataset.node);
  // 1回目のタップは選ぶだけ。ダブルクリック(ダブルタップ)かキーボードの Enter で中に入る
  const enter = e.detail >= 2 || e.detail === 0;
  if (n.kind === "card") { st.nestCard = st.nestCard === n.id ? null : n.id; st.nestSel = n.id; renderNest(); return; }
  if (!enter) { st.nestSel = n.id; renderNest(); return; }
  st.nestSel = null;
  if (n.kind === "box") { st.nest.push(n.id); st.nestCard = null; renderNest(); }
  else openNestCube(n);
});
$("drill").onclick = drill;
$("view-cube").onclick = () => { st.view = "cube"; render(); };
$("view-sheet").onclick = () => { st.view = "sheet"; st.mode = "aggregate"; st.slice = null; render(); };
$("face").addEventListener("click", e => {
  const b = e.target.closest(".hdr");
  if (b && lastRC) enterAxisMember(b.dataset.slot, lastRC[b.dataset.slot].members[Number(b.dataset.i)]);
});
const pickCell = td => { if (!td || !td.dataset.r) return false; st.sel = [td.dataset.r, td.dataset.c]; render(); return true; };
// 1回目で選び、2回目(ダブルクリック)で潜る。表は描き直されるので dblclick ではなくクリック回数で判定する
$("face").addEventListener("click", e => {
  if (e.target.closest(".hdr")) return;
  const td = e.target.closest("td");
  if (e.detail >= 2 && st.sel) { if (!$("drill").disabled) drill(); return; }
  pickCell(td);
});
$("face").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickCell(e.target.closest("td")); } });

render();
})();
