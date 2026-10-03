# 立体テーブル管理システム 設計書(v0.1)

> この設計書は Claude Code で実装を進めるためのものです。リポジトリ直下に置き、実装時は常に参照してください。
> 進め方はアジャイル(スプリント単位)。各スプリントの「完了条件」を満たしたら次へ進みます。

---

## 1. 目的と背景

リレーショナルデータベース(RDB)では、テーブルの1カラムの中にさらに内訳があり、その内訳にもまた内訳がある、という構造がよく発生する。これを2次元のテーブルだけで追うと「どこからどこへ引っ張ってきているのか」が分からなくなる。

本システムは、**既存のRDB(業務データ = OLTP)を作り直さずに、立体的(多軸)に閲覧・探索できる層**を提供する。

### 実現したい体験

- 正面に「店舗 × 項目(引き継ぎ情報など)」の表があり、その**奥行き**に「その店舗でいつ何が売れたか」が積み重なっている
- 立体を**回転**して、正面以外の面(店舗 × 時間、項目 × 時間 など)から見られる
- 軸そのものを**別の軸に入れ替え**られる
- 1コマを開くと、その中にさらに**別の3軸の立体(入れ子)**があり、どこまでも潜れる
- **隣り合うコマ同士の中身を比べて、共通部分・差分を抽出**できる

### 位置づけ

- OLAPの「考え方」(軸・回転・断面・ドリルダウン)は取り入れる
- OLAPの「製品・仕組み」(事前に固定したキューブ)は採用しない。文字情報や1件単位の明細が落ち、自由に潜れなくなるため
- データの保存先は既存のRDBのまま。本システムはその上に乗る**閲覧・操作の層**
- 当面は**読み取り専用**。更新は最終スプリントで「一番奥のコマ(1件のデータ)」に限って元テーブルへ書き戻す

---

## 2. 用語定義

実装・コード上の命名はこの表に揃えること。

| 用語 | コード上の名前 | 意味 |
|---|---|---|
| 軸 | `Axis` | 立体の1方向。例：店舗、項目、時間、商品、担当者 |
| 軸の値 | `AxisMember` | 軸上の1目盛り。例：A店、10月、商品X |
| 立体 | `Cube` | 3本の軸と、各コマに入る値の定義の組 |
| 立体定義 | `CubeSpec` | 立体をどのデータからどう作るかを表すJSON(後述) |
| 座標 | `Coordinate` | コマの位置。各軸の値の組。例：`{store: "A", item: "売上", month: "2026-10"}` |
| コマ | `Cell` | 座標1つ分の箱。値(数値・文字・件数など)を持つ |
| 面 | `Face` | 立体を2軸で見た平面。残り1軸は「集約」または「断面で固定」 |
| 断面 | `Slice` | 残り1軸を特定の値で固定して切り出した面 |
| 集約 | `Aggregation` | 残り1軸を潰して1つの値にまとめる方法(合計、件数、最新、一覧など) |
| 潜る | `Drill` | コマを開き、その座標を条件にした内側の立体へ移ること |
| 現在地 | `Breadcrumb` | 外側から今いる立体までの座標の連なり |
| 比較 | `Compare` | 2つのコマの内側の立体を、共通する軸で突き合わせること |

---

## 3. 技術スタック

| 層 | 採用技術 | 理由 |
|---|---|---|
| フロント | Next.js(App Router)+ TypeScript | 画面とAPIを1つのリポジトリで扱える |
| 3D表示 | React Three Fiber(three.js) | Reactの部品として立体を描ける |
| 2D面表示 | 通常のHTMLテーブル(仮想スクロール：TanStack Virtual) | 面の表示は2Dの方が読みやすいため、3Dと併用 |
| 状態管理 | Zustand | 現在の立体・面・現在地を軽く持つ |
| DB | PostgreSQL(Supabase) | 既存のSupabaseを利用。ローカルは Supabase CLI |
| DBアクセス | サーバー側で `postgres`(postgres.js)によるSQL生成 | 動的な集約クエリを組み立てるため、ORMより直接SQLが扱いやすい |
| テスト | Vitest(ロジック)、Playwright(画面) | |
| デプロイ | Vercel | |

---

## 4. 全体構成

```
[ブラウザ]
  ├─ 3Dビュー(立体の全体像・回転・コマ選択)
  ├─ 面ビュー(選択中の面を2D表で表示)
  ├─ 現在地(パンくず)
  └─ 比較パネル
        │  CubeSpec / 操作をJSONで送信
        ▼
[API(Next.js Route Handlers)]
  ├─ クエリエンジン：CubeSpec → 安全なSQL → 結果を Cube/Face 形式に整形
  ├─ メタデータ読み込み：軸定義・立体定義
  └─ 比較エンジン：2つの内側立体を共通軸で突き合わせ
        │
        ▼
[PostgreSQL]
  ├─ 業務テーブル(既存 or サンプル)
  └─ メタデータテーブル(本システム用：軸・立体の定義)
```

**重要な原則**：業務テーブルの構造は一切変更しない。本システム用の情報はすべてメタデータテーブル(スキーマ `cube_meta`)に置く。

---

## 5. データモデル

### 5.1 サンプル業務テーブル(スプリント0で作成・シード投入)

架空の店舗データ。実DB接続(スプリント5)までの開発はこれで行う。

```sql
-- 担当者マスタ(store_handover_notes から参照されるため先に作成する)
create table staff (
  id    text primary key,
  name  text not null
);

-- 店舗マスタ
create table stores (
  id          text primary key,      -- 'S001'
  name        text not null,         -- 'A店'
  area        text not null,         -- '広島市中区'
  opened_on   date
);

-- 店舗の引き継ぎ情報(文字情報の軸の例)
create table store_handover_notes (
  id          bigserial primary key,
  store_id    text not null references stores(id),
  category    text not null,         -- '設備' '人員' '顧客対応' など
  content     text not null,
  written_at  timestamptz not null,
  author_id   text references staff(id)
);

-- 商品マスタ
create table products (
  id        text primary key,
  name      text not null,
  category  text not null            -- '飲料' '食品' など
);

-- 売上明細(奥行きになる大量データの例)
create table sales (
  id          bigserial primary key,
  store_id    text not null references stores(id),
  product_id  text not null references products(id),
  staff_id    text references staff(id),
  sold_at     timestamptz not null,
  quantity    int not null,
  amount      int not null           -- 円
);
```

シード規模の目安：店舗10、担当者20、商品50、引き継ぎメモ200、売上 約5万件(12か月分)。店舗ごとに売上件数をあえて偏らせる(奥行きの不揃いを再現するため)。

### 5.2 メタデータテーブル(本システム用)

```sql
create schema cube_meta;

-- 軸の定義
create table cube_meta.axes (
  key            text primary key,   -- 'store' 'product_category' 'month'
  label          text not null,      -- '店舗'
  kind           text not null,      -- 'entity' | 'attribute' | 'time' | 'columns'
  source_table   text,               -- 'stores'
  source_column  text,               -- 'id'
  label_column   text,               -- 'name'(表示名に使う列)
  key_column     text,               -- source_table の行を特定する列。事実テーブルから結合するときに使う(例: 'id')
  time_grain     text,               -- kind='time' のとき 'day'|'week'|'month'|'year'
  master_key     text                -- 同じ「ものさし」を共有する軸の識別子(比較に使う)
);

-- 事実テーブル(コマの中身の出どころ)の定義
create table cube_meta.facts (
  key            text primary key,   -- 'sales' 'handover_notes'
  label          text not null,
  source_table   text not null,
  -- 軸キー → このテーブルの列 の対応
  axis_columns   jsonb not null,     -- {"store":"store_id","product":"product_id","month":"sold_at"}
  -- 使える値と集約方法
  measures       jsonb not null      -- [{"key":"amount","column":"amount","type":"number","aggs":["sum","avg","count"]}]
);

-- 保存した立体(よく使う視点のブックマーク)
create table cube_meta.saved_cubes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  spec        jsonb not null,        -- CubeSpec
  created_at  timestamptz default now()
);
```

#### 軸の `kind`

| kind | 意味 | 例 |
|---|---|---|
| `entity` | マスタテーブルの行が目盛りになる | 店舗、商品、担当者 |
| `attribute` | 列の値の種類が目盛りになる | 商品カテゴリ、引き継ぎメモのカテゴリ |
| `time` | 日時列を粒度で区切ったものが目盛りになる | 月、週、日 |
| `columns` | **テーブルの列名そのもの**が目盛りになる | 店舗リストの「項目」軸(地域、開店日、最新引き継ぎ…) |

`columns` 軸があることで、「店舗 × 項目」という普通の一覧表を、そのまま立体の正面として扱える。

#### 事実テーブルから軸への結びつけ(`axis_columns` と `key_column`)

事実テーブル側の `axis_columns` には「この軸を表す、事実テーブルの列」を書く。軸側の定義と組み合わせて、列式は次のように決まる。

| 軸の種類 | 列式 |
|---|---|
| `time` | `date_trunc(粒度, 事実.列)`(日本時間で区切る) |
| `entity` | `事実.列`(マスタの `source_column` の値そのもの。表示名は `label_column` から引く) |
| `attribute` で `source_table` が事実テーブル自身 | `事実.列` |
| `attribute` で `source_table` が別テーブル | `source_table` を `key_column = 事実.列` で結合し、`source_table.source_column` |

例:商品カテゴリ軸は `source_table = products, source_column = category, key_column = id`。売上は `axis_columns.product_category = "product_id"` と書き、`join products on products.id = sales.product_id` で `products.category` を使う。結合の仕方を軸に1回書けば、在庫など別の事実テーブルでも同じ軸を使い回せる。

#### `master_key` と比較

隣のコマと比較するとき、軸が「同じものさし」かどうかを `master_key` で判定する。
例：売上の `product` 軸と在庫の `product` 軸がどちらも `master_key = 'products'` なら比較可能。異なれば比較対象外として画面に明示する。

---

## 6. CubeSpec(立体定義)

画面とAPIの間でやり取りする、立体の唯一の表現。**すべての操作は CubeSpec の変換として実装する**(回転・潜る・比較のいずれも)。

```ts
type CubeSpec = {
  fact: string;                    // cube_meta.facts.key 例: 'sales'
  axes: [AxisRef, AxisRef, AxisRef];  // x, y, z(奥行き)
  measure: {
    key: string;                   // 'amount'
    agg: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'latest' | 'list';
  };
  filters: Filter[];               // 外側の座標から引き継いだ条件など
  limits?: { perAxis?: number };   // 目盛りが多すぎるときの上限(既定 50)
};

type AxisRef = { key: string; grain?: 'day'|'week'|'month'|'year' };

type Filter = { axis: string; op: 'eq' | 'in' | 'between'; value: unknown };
```

### 面の取得

```ts
type FaceRequest = {
  spec: CubeSpec;
  view: { rows: 0|1|2; cols: 0|1|2 };   // axes の何番目を行・列にするか
  depth:                                  // 残り1軸の扱い
    | { mode: 'aggregate' }               // 集約して潰す
    | { mode: 'slice'; member: string };  // 特定の値で断面を切る
};
```

### 操作と CubeSpec の変換

| 操作 | 変換内容 |
|---|---|
| 回転(面の切り替え) | `view.rows` / `view.cols` を入れ替える。CubeSpec自体は不変 |
| 軸の入れ替え | `axes` のいずれかを別の軸に置き換える |
| 断面 | `depth` を `slice` にする |
| 潜る(Drill) | 選んだコマの座標を `filters` に追加し、`axes` を内側用の3軸に差し替える(`fact` も変えてよい) |
| 戻る | 現在地スタックから1つ前の CubeSpec を取り出す |
| 比較 | 2つのコマそれぞれで Drill した CubeSpec を作り、比較エンジンへ渡す |

**現在地(パンくず)は CubeSpec のスタック**として持つ。URLにも埋め込み(base64 JSON)、リロードや共有で同じ場所に戻れるようにする。

---

## 7. クエリエンジン

### 7.1 SQL生成の流れ

1. CubeSpec をメタデータで検証(存在しない軸・列・集約は拒否)
2. 各軸の列式を決定(5.2「事実テーブルから軸への結びつけ」に従う。`time` 軸は `date_trunc(grain, 列)` で、区切りは日本時間 `Asia/Tokyo`)
3. 面の要求に応じて、行・列の2軸で `GROUP BY` する。奥行きの軸は、集約なら `GROUP BY` に含めずSQLで潰し、断面ならその値を条件に加える
   - 3軸で集計してからサーバー側で潰すと、平均・最小・最大などが正しく求まらない(平均の平均になる)ため、SQLの段階で潰す
4. 表示名を `label_column` から引いて返す

### 7.2 安全性(必須)

- **テーブル名・列名は必ずメタデータの値からのみ組み立てる**(ホワイトリスト)。リクエストの文字列をそのままSQLに入れない
- 値(フィルタの値)はすべてパラメータ化する
- 1リクエストのタイムアウトは 10秒、結果は最大 50×50×50 コマに制限

### 7.3 集約の種類と値の型

| 値の型 | 使える集約 | コマの表示 |
|---|---|---|
| 数値 | sum, avg, count, min, max | 数値 |
| 文字 | count, latest, list | 件数 / 最新の1件 / 一覧(先頭3件+「他N件」) |
| 日時 | min, max, count | 日時 |

### 7.4 奥行きの不揃いへの対応

店舗ごとに売上件数が大きく違うため、奥行きの軸は**明細行そのものではなく、時間などで区切った目盛り**にするのを基本とする。明細行を直接並べたいときは、最も内側(葉)の立体でのみ `list` 集約を使う。

### 7.5 性能

- 開発段階では毎回SQLで集計してよい
- 遅くなった面だけ、マテリアライズドビューで事前集計(キャッシュ)する。どの面をキャッシュするかは計測してから決める

---

## 8. 比較エンジン(共通抽出・差分)

### 入力

```ts
type CompareRequest = {
  left:  CubeSpec;   // 例: A店・10月 の内側(商品 × 時間帯 × 担当者)
  right: CubeSpec;   // 例: B店・10月 の内側
  mode: 'intersection' | 'left_only' | 'right_only' | 'diff_value';
};
```

### 処理

1. 左右の軸のうち `master_key` が一致する軸を「共通軸」とする
2. 共通軸が0本ならエラー(画面に「比較できる共通の軸がありません」と表示)
3. 共通軸以外は集約して潰し、共通軸の座標だけで両者を突き合わせる
4. モードに応じて返す
   - `intersection`：両方に値がある座標
   - `left_only` / `right_only`：片方にだけある座標
   - `diff_value`：両方にある座標の値の差
5. 結果は「共通軸の数」に応じて立体(3本)・面(2本)・リスト(1本)のいずれかで返す

SQLでは左右を同じ共通軸で集約したサブクエリ同士の `FULL OUTER JOIN` で実装する。

---

## 9. API設計

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/meta/axes` | 軸定義一覧 |
| GET | `/api/meta/facts` | 事実テーブル定義一覧(使える軸・値・集約を含む) |
| POST | `/api/cube/face` | `FaceRequest` → 面のデータ |
| POST | `/api/cube/overview` | `CubeSpec` → 3Dビュー用の全コマ概要(値の大小のみ、軽量) |
| POST | `/api/cube/drill-options` | 座標を受け取り、潜れる先(内側の立体の候補)を返す |
| POST | `/api/cube/compare` | `CompareRequest` → 比較結果 |
| POST | `/api/cube/saved` | 視点の保存 |
| PATCH | `/api/cell` | (スプリント6)葉コマの書き戻し |

レスポンスの形式：

```ts
type FaceResponse = {
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  cells: (CellValue | null)[][];   // rows × cols
  meta: {
    truncated: boolean;
    totalMembers: Record<string, number>;
    depthMembers: { key: string; label: string }[];  // 奥行きの軸の目盛り(断面の値を選ぶのに使う)
  };
};

type CellValue =
  | { type: 'number'; value: number }
  | { type: 'text'; value: string; count: number }
  | { type: 'list'; items: string[]; more: number };
```

---

## 10. 画面設計

### レイアウト(1画面構成)

```
┌───────────────────────────────────────────────┐
│ 現在地：全店舗 › A店 › 売上 › 2026年10月        [戻る] │
├──────────────────────┬────────────────────────┤
│                      │ 軸設定                    │
│   3Dビュー            │  X: 店舗   ▼              │
│  (立体の全体像)        │  Y: 項目   ▼              │
│   ・ドラッグで回転      │  Z: 月     ▼   [入れ替え]   │
│   ・面をクリックで選択   │ 値: 売上金額 / 合計 ▼       │
│   ・コマをクリックで選択 │ 奥行き: ○集約 ○断面[10月▼]│
├──────────────────────┴────────────────────────┤
│ 面ビュー(選択中の面を2D表で表示)                    │
│   コマをダブルクリック → 潜る                        │
│   コマを2つ選択 → [比較] ボタン                      │
└───────────────────────────────────────────────┘
```

### 3Dビューの方針

- 3Dは「全体の把握と、どの面・コマを見るかの選択」に使う。数値や文字を読むのは面ビュー(2D)で行う
- コマは値の大きさを色の濃さで表現(文字データは件数で)
- 目盛りが多い軸は上位N件+「その他」にまとめる
- 回転は「正面・上面・側面」の3方向にスナップするボタンも用意(自由回転だけだと迷うため)

### 現在地(パンくず)

- 常に画面上部に表示。任意の階層をクリックするとその立体へ戻る
- 潜った先の立体の軸構成が変わっても、外側から引き継いだ条件(座標)をすべて表示する

---

## 11. スプリント計画

各スプリントは「動くものを触って確かめる」ことを目的にする。完了条件を満たしたら、ユーザーに画面を見せて次のスプリントの内容を調整する。

### スプリント0：土台

- Next.js + TypeScript のプロジェクト作成、Supabase CLI でローカルDB
- 5.1 のサンプルテーブル作成とシード投入スクリプト
- 5.2 のメタデータテーブル作成と、サンプル用の軸・事実定義の投入
- **完了条件**：`npm run dev` で起動し、`/api/meta/axes` が軸一覧を返す

### スプリント1：クエリエンジンと面ビュー

- CubeSpec の型定義と検証
- `/api/cube/face` の実装(集約・断面の両方)
- 面ビュー(2D表)と軸設定パネル
- **完了条件**：「店舗 × 月(奥行き：商品カテゴリを集約)」の売上合計が表で見られ、行・列・奥行きの軸を入れ替えられる。クエリエンジンの単体テストが通る

### スプリント2：3Dビューと回転

- React Three Fiber で立体の概要表示(`/api/cube/overview`)
- ドラッグ回転と、正面・上面・側面へのスナップ
- 3Dで選んだ面が面ビューに反映される
- `columns` 軸を使った「店舗 × 項目」の正面表示(引き継ぎメモなど文字データを含む)
- **完了条件**：店舗リスト(店舗 × 項目)を正面に、奥行きに月別売上がある立体を回転させ、上面(店舗 × 月)を面ビューで読める

### スプリント3：潜る(入れ子)と現在地

- `/api/cube/drill-options` と Drill 操作
- 現在地スタック、パンくず表示、URLへの保存
- **完了条件**：「A店・10月」のコマから「商品 × 時間帯 × 担当者」の内側立体に潜り、さらにその中の1コマへ潜れる。パンくずから任意の階層へ戻れ、URLを開き直しても同じ場所が表示される

### スプリント4：比較(共通抽出・差分)

- 比較エンジンと `/api/cube/compare`
- 面ビューでコマを2つ選んで比較する画面
- **完了条件**：「A店・10月」と「B店・10月」を比較し、両店で共通して売れた商品、片方だけで売れた商品、金額差が表示される。共通軸がない組み合わせではその旨が表示される

### スプリント3.5：ダッシュボード

立体の操作に慣れていない人でも、数値とグラフで読めるようにする。

- 面ビューで見ている面を「ダッシュボードに追加」すると、数値カード・棒グラフ・折れ線グラフ・表のいずれかのタイルとして保存する。ダッシュボード画面には3Dを出さない
- 面の形からグラフの種類を自動で選ぶ(列が時間なら折れ線、それ以外は棒、1マスだけなら数値カード)。あとから手で変えられる
- タイルをクリックすると、Cube Explorer のその場所(同じ面・同じ階層)を開く
- メタデータに `cube_meta.dashboards` と `cube_meta.dashboard_tiles`(タイルごとの `FaceRequest`・現在地・グラフ種類・並び順)を追加する。タイルの値は `/api/cube/face` で毎回取り直し、SQLを組み立てる経路は増やさない
- API:`/api/dashboards`(一覧・作成・タイルの追加と並べ替え)
- **完了条件**：潜った先の面を含む3つ以上の面をダッシュボードに追加し、3Dを触らずに数値とグラフで読める。タイルから元の場所へ戻れる

### 公開版 v0:実データで触る(2026-10-03 追加)

ユーザーの依頼(「実際のデータを入れられるように、プラットフォームとしてデプロイしてください。後は触りながら開発します」)で、スプリント2以降を待たずに、試作で固めた操作を実データで触れる形にして公開する。ここで作ったものは、以降のスプリントで正式な形に置き換えていく。

- **対象データ**:申込者 › 契約者 › 法人(課税・免税)› ショップ › 月別入金(内訳つき)の5表(`applicants` `contractors` `companies` `shops` `deposits`)。決まった列にない項目は `extra`(jsonb)に入れ、情報カードにそのまま出す
- **取り込み**:`/import` で CSV(UTF-8・Shift_JIS)・Excel(.xlsx)を表ごとに取り込む。コードが同じ行は上書きする。親のコードがまだない行はまとめてエラーにする。ひな形の CSV をダウンロードできる
- **画面**:`/` の入金キューブは、試作(素の JS + three.js r128)をそのまま移したもの(`explorer/`、`scripts/build-explorer.mjs` でまとめる)。立体・潜る・シート・入れ子・課税区分フィルターは試作と同じ動き。スプリント2で React Three Fiber に置き換えるときも、この操作を引き継ぐ
- **集計の場所**:v0 は入金明細を全件ブラウザに送り、ブラウザで集計する。数万行までを想定する。件数が増えたらクエリエンジン(7章)経由に切り替える
- **ログイン**:Neon Auth(Better Auth ベース)のメールの6桁コード。`ALLOWED_EMAILS` に入れたメールアドレスの人だけが見られる。全ページと API で確認する(入口は `src/proxy.ts`)。表は RLS を有効にし、データベースの API(Neon の Data API など)を有効にしても直接は読めないようにする
- **置き場所**:データベースとログインは Neon、画面は Vercel(fratflat チーム)。当初は Supabase(Pro・東京)の予定だったが、無料枠の空きがなく Docker なしで手元でも動かせるよう、2026-10-03 にユーザー判断で Neon に変更。表は RLS を有効にしたまま、アプリはテーブルの持ち主の接続で読む
- スプリント1の面ビューは `/face` に移す
- **手元での本番相当環境**(2026-10-03 追加):`npm run local` で、Neon のデータベースとログインにつないだ本番ビルドを手元で立ち上げる(Docker 不要)。テーブルと架空のサンプルデータ(`supabase/seed_deposit.sql`)は `scripts/db-setup.mjs` が入れる

### キューブの組み立て(2026-10-03 追加・提案中)

ユーザーの依頼(「実際のデータが入れられるように、キューブの作り込みから始めたい」「CSV でのインポート機能も必要だが、この中で組み立てられるようにしたい」)で、キューブの形とデータを**画面の中で組み立てられる**ようにする。公開版 v0 の入金キューブは「申込者 › 契約者 › 法人 › ショップ › 入金」の5表と列が固定だが、これを利用者が自分で作れるようにする。

#### 位置づけの変更

1章では「データは既存のRDBのまま、本システムは閲覧の層」としていた。組み立てたキューブについては、**データそのものを本システムのデータベース(Neon)に持つ**。既存のRDBにつなぐ方式(スプリント5)はそのまま残し、両方を使えるようにする。

#### 組み立ての考え方(2026-10-03 改訂:キューブから作る)

最初の案は「段と項目を作り、軸は型から自動で決める」だったが、ユーザーから「表示方法がわかりづらい。キューブを作ってから X軸・Y軸・Z軸を設定しながら作り込む仕様にしたい」「作ったキューブの上位や下位のキューブも作れるようにしたい」「設定したところからプレビューで見たい」との判断があり、**キューブを単位に組み立てる**形に改める。試作:https://claude.ai/artifact/PSSQLtzpGdKrWSMySXSNtz

#### 用語(2章に追加)

| 用語 | コード上の名前 | 意味 |
|---|---|---|
| キューブ | `BuiltCube` | 利用者が作る立体の表。名前、X・Y・Z の3軸、値、コマを持つ |
| 軸 | `BuiltAxis` | 名前と目盛り。目盛りは「自分で並べる」(法人名など)か「年月の範囲」(2026-04〜2026-09)で決める |
| 値 | `BuiltValue` | コマの中身。名前、型(金額・数値・文字)、面で見るときのまとめ方(合計・平均・件数・最大・最小) |
| 上位・下位 | `parent` / `via` | 下位のキューブは、上位のキューブの1つの軸(`via`)の目盛りごとに1つずつ中身を持つ。例:法人別の入金(上位)の「法人」軸の目盛りごとに、ショップ別の入金(下位) |
| 組み立て | `Builder` | キューブを作り、軸と値を決め、データを入れる画面 |

#### 組み立てでできること

1. **キューブを作る**:名前を付け、X(横)・Y(縦)・Z(奥)の軸ごとに名前と目盛りを決める。値の名前・型・まとめ方を決める。軸の色は X 紫・Y 緑・Z ピンク(3Dラベルの規則と同じ)
2. **下位のキューブを作る**:選んだキューブのどの軸の目盛りごとに中身を持つかを選んで作る。1つのキューブに下位をいくつでも付けられる(法人ごとに「ショップ別の入金」と「基本情報」など)
3. **上位のキューブを作る**:今のキューブを包む上位を作る。今のキューブは上位の X 軸の目盛りごとの下位になり、今のデータは最初の目盛り「(区分1)」の中に入る(後で目盛り名を直す)
4. **プレビュー**:設定を変えるたびに立体が描き直される。正面・上面・側面・斜めに切り替えられ、ドラッグで回せる。コマを選ぶと中身と「〇〇の『下位キューブ』へ」の移動ボタンが出る。立体の下に、見えている面の表(見えない軸の方向にまとめ方で集計)を出す
5. **白紙とテンプレート**:最初はキューブが1つもない状態で始まる。「テンプレートから始める」で、入金管理(法人別の入金 › ショップ別の入金・法人の基本情報、架空データ入り)、店舗の売上(› 担当者別の売上)、軸だけのひな形を読み込んでから直せる

#### データの入れ方

- **画面で入力**:キューブの X×Y の表に入力する。Z は1枚ずつ切り替える。下位のキューブは、どの上位の目盛りの中かを先に選ぶ
- **CSV・Excel の取り込み**:列は「上位の軸(下位のときだけ)・X・Y・Z・値」。見出しが軸の名前と同じなら自動でつなぐ。ファイルにあってまだない目盛りは自動で足す。ひな形 CSV を出せる

#### データの持ち方

キューブを足すたびにテーブルを作る(DDL を流す)のではなく、**決まったテーブルに定義とコマを入れる**。画面から安全に作り変えられ、マイグレーションも要らないため。

```sql
create table cube_meta.built_cubes (   -- 利用者が作るキューブ
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  parent_id   uuid references cube_meta.built_cubes(id) on delete cascade,  -- 上位(なしも可)
  via_axis    text check (via_axis in ('x','y','z')),   -- 上位のどの軸の目盛りごとか
  value_name  text not null,
  value_type  text not null,           -- 'money' | 'number' | 'text'
  value_agg   text not null,           -- 'sum' | 'avg' | 'count' | 'max' | 'min'
  position    int not null
);

create table cube_meta.built_axes (    -- キューブの3軸
  cube_id     uuid not null references cube_meta.built_cubes(id) on delete cascade,
  axis        text not null check (axis in ('x','y','z')),
  name        text not null,
  kind        text not null,           -- 'list' | 'month'
  members     jsonb,                   -- kind = 'list' の目盛り(並び順どおり)
  month_from  text,                    -- kind = 'month' の範囲 'YYYY-MM'
  month_to    text,
  primary key (cube_id, axis)
);

create table cube_data.built_cells (   -- コマ
  cube_id     uuid not null references cube_meta.built_cubes(id) on delete cascade,
  parent_path text not null default '', -- 上位の目盛りのたどり(最上位は空)
  x           text not null,
  y           text not null,
  z           text not null,
  value       jsonb not null,          -- 数値か文字
  updated_at  timestamptz not null default now(),
  primary key (cube_id, parent_path, x, y, z)
);
```

- 面の表と立体は、キューブの定義から軸・事実の定義を作り、クエリエンジン(7章)で集計する。テーブル名・列名は定義の値からのみ組み立てる(7.2 のホワイトリストの考え方を守る)
- 想定する量はキューブごとに数十万コマまで。遅くなったら `(cube_id, parent_path)` などにインデックスを足す
- 公開版 v0 の入金キューブは、この仕組みで作ったテンプレート「入金管理」として同梱する
- 以前の案の「入れ子の種類」(情報カード・入れ物・データのキューブ)は、値の型が文字のキューブ(情報カード)と、下位を持つキューブ(入れ物)で表せるので、別の定義は持たない

#### 未決(13章に追加)

| 項目 | 内容 |
|---|---|
| 型を変えたとき | データが入っているキューブの値の型を変えるとき、変換できない値をどう扱うか |
| 目盛りの削除 | データが入っている目盛りを消すとき、コマも消すか、確認を出して止めるか |
| 削除と履歴 | コマの削除を論理削除にするか、変更履歴を残すか(スプリント6の履歴と合わせる) |
| 編集の権限 | 当面はログインできる人全員が組み立て・編集できる。分けるかは権限の検討時に決める |

### スプリント5：実DBへの接続

- 既存DBのスキーマ(外部キー)を読み取り、軸・事実定義の**候補を自動生成**する機能
- 管理画面で候補を確認・修正してメタデータに保存
- **完了条件**：サンプル以外のテーブル構成でも、設定画面から軸を定義して立体表示できる

### スプリント6：葉コマの書き戻し

- 最も内側のコマ(1件のデータ)に限り、値を編集して元テーブルに保存
- 変更履歴の記録
- **完了条件**：引き継ぎメモを1件編集し、元テーブルに反映される。集約されたコマは編集できない

---

## 12. Claude Code での進め方

- 1スプリントずつ実装する。スプリントをまたいで先回りの実装をしない
- 各スプリント開始時に、そのスプリントのタスクを分解して提示してから着手する
- 用語・型名は「2. 用語定義」「6. CubeSpec」に合わせる
- SQLの組み立ては必ず「7.2 安全性」に従う。違反するコードは書かない
- 設計を変える必要が出たら、実装前にこの設計書を更新し、変更点をユーザーに確認する
- 各スプリントの完了時に、完了条件を満たしているかを実際に動かして確認する(ロジックは Vitest、画面は Playwright)

---

## 13. 未決事項(今後決めること)

| 項目 | 内容 | 決める時期 |
|---|---|---|
| 利用者 | エンジニア向けか、業務担当者向けか(画面の難しさが変わる) | スプリント1の後 |
| 接続する実DB | どのDB・どのテーブルを最初に対象にするか | スプリント4の後 |
| 3軸を超える場合 | 4軸目以降を絞り込み条件として扱うUIの詳細 | スプリント3の後 |
| 権限 | 閲覧・書き戻しの権限管理 | スプリント6の前 |
| 性能目標 | 対象データ量と許容応答時間 | スプリント5の前 |
