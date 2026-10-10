# ホームと Task の SQL(W3 への下書き)

ホーム(`GET /api/4db/home`)と Task(`GET /api/4db/tasks`・`/tasks/count`)の SQL の試作と、規模での測定の記録です(D-017、作業指示 P2 の 4〜5 章)。
**SQL の本文は `../home.scale.test.ts` にあります**(`q1`・`q2a`・`q2b`・`q2cDims`・`q2cSheets`・`q3aFromS`・`q3b`・`q3cFromS`・`q4`・`qTasks`・`qCount` と、組み立ての `homeOverview`・`taskOverview`・`taskCount`)。試験の中で実際に流している文なので、そのまま `adapters/postgres/home.ts`・`tasks.ts` に移せます。ここには、組み立て方・測った結果・気をつけることを書きます。

- 状態: AI PROPOSAL(試作)。ローカルの使い捨てデータベース(PostgreSQL 18.1、localhost)で測った。本番(Neon)では測っていない。
- どの文も withScope の中で、`statement_timeout` 10s、workspace をパラメータでも絞る(RLS は重ねの守り)。表名・列名は固定、値はすべてパラメータ。

## 組み立て(すすめる形 = B)

```
withScope(begin・principal と workspace の設定)
  set_config('statement_timeout', '10s', true)
  1. Q1(単位)                                  → 芯の orderUnits(groups).shown で出す単位を決める
  2. Q2a・Q2b・Q2c(軸)・Q2c(シート = S)・Q4 を、同じ取引で順に送ってまとめて待つ(Promise.all。apply.ts と同じ)
  3. Q3a・Q3c に、2 の S(ord・sheet_id・via_rows)をパラメータで渡して、まとめて待つ
  4. Q3b(単位ごとに芯の orderColumns の先頭 12 の数値だけ。3 の列の id を渡す)
  → 芯の buildHomeOverview(facts)
commit
```

- **S(元のシート)は 1 回だけ求める。** S を Q2c・Q3a・Q3c のそれぞれの CTE で求める形(A。1 回の往復にまとめられる)は、S が重い V2 でホームが約 2 倍になった(677ms → 348ms)。往復が 1 回増えても B のほうが速い。結果は A と B で同じ(試験で確かめている)。
- Q3b は芯の並べ方(`orderColumns`。UTF-16 の順)で選んだ 12 個に対して引くので、Q3a のあとの往復になる。
- Box が 0 なら Q1 のあとで終わる(`units: []`)。S が空なら 3 を飛ばす。

## 測った結果(5 回の真ん中。withScope の begin〜commit を含む。単位は ms)

データ: `scale.sql`(行 288,000・値 2,880,000)+ `scale_home.sql`(Box 8,500・Box に結んだ行 296,000・値 3,264,000 のうち計算された値 288,000・シート 990・取り込みの記録 11,700・表の定義 60)。
実行用の役割 `fourdb_scale_app`(superuser でも持ち主でもない)で、RLS がかかった状態。

| | V1・0007 あり | V1・0007 なし | V2・0007 あり | V2・0007 なし | 目安 |
|---|---:|---:|---:|---:|---:|
| ホーム(通し、B) | **90.9** | 1,383.4 | **348.3** | 2,598.3 | V1 300・V2 1,000 |
| ホーム(通し、A: S を 3 回) | 99.9 | 1,454.6 | 677.3 | 2,891.7 | |
| Task(通し) | **27.4** | 29.3 | **28.2** | 26.4 | 100 |
| 件数(通し) | **16.8** | 16.9 | **16.3** | 16.4 | 50 |
| Q1 単位 | 3.3 | 5.4 | 4.8 | 5.2 | |
| Q2a 名前 | 1.8 | 2.7 | 11.4 | 11.6 | |
| Q2b 中に | 19.0 | 19.2 | 15.0 | 13.7 | |
| Q2c 軸(D) | 3.7 | 3.7 | 22.0 | 23.1 | |
| Q2c 元のシート(S) | 13.3 | 12.5 | 178.9 | 178.8 | |
| Q3a 列(B: S を渡す) | 20.1 | 22.9 | 35.0 | 44.5 | |
| Q3b ƒ | 6.4 | 1,281.2 | 11.1 | 2,197.1 | |
| Q3c 期間(B: S を渡す) | 22.2 | 26.4 | 27.1 | 35.6 | |
| Q4 表の定義 | 1.6 | 1.8 | 0.9 | 2.8 | |

(Q3b の数値は V1 が 12 個・列 11,385 本、V2 が 24 個・列 22,770 本。)

- **0007(計算された値の部分索引)がないと、どちらも目安を超える。** 0007 があれば、V1・V2・Task・件数のすべてが目安に収まる。
- V1 で 0007 なしの Q3b の実行計画(要点): `Index Scan using value_column on value v … Index Cond: (column_id = ANY (t.cols)) Filter: ((system_to IS NULL) AND (workspace_id = …) AND (kind = 'calculated'))`、`Rows Removed by Filter: 245520`、`Buffers: shared hit=17248 read=47911`、実行 1,079ms。列の索引はすべての版・すべての種類の値を持つので、計算された値がない数値ほど列の値をすべて読む。0007 なら、ない列は索引を見るだけで終わる(6.4ms)。
- V2 の S(178ms)の実行計画(要点): (c) 行で結ばれたシート の枝が大半。`Nested Loop … CTE Scan on tb (rows=8500)` → `Index Scan using record_box on record r … Index Searches: 8500 … rows=296000`、`Buffers: shared hit=71421`、そこから (単位, シート) 1,000 組にまとめる。単位の Box に結ばれた行をすべて読むため、行の数に比例する。
  - 試し: `record (box_id, sheet_id) where system_to is null` の部分索引を足しても速くならなかった(workspace の条件〔パラメータと RLS〕を見るために表を読むので、索引だけで終わらない)。今の目安には収まっているので、何も足していない。本番で V2 の規模が目安を超えるときに、workspace_id も含めた索引を試す(案。未検証)。

## 気をつけること(W3)

1. **postgres.js は真偽の配列を `bool[]` でなく `bool`(oid 16)として送る**ので、`${[true, false]}::bool[]` は 42846 で止まる。`via_rows` は `'t'`・`'f'` の文字の配列で渡し、SQL で `= 't'` にする(`sParamCte`)。
2. 数(`count(*)`・`with ordinality` の番号・`bigint`)は postgres.js では文字で返る。番号と数は SQL で `::int` にする。列の id(bigint)は文字のまま扱い、Q3b に `jsonb_to_recordset(…) as t(k int, cols bigint[])` で戻す。
3. 期間(date)は `::text` で返す(postgres.js が Date にすると時差でずれうる)。`period_end` は含まない日なので、芯の `formatPeriod` が 1 日戻す。
4. 並べ方: 名前(Q2a)は DB の並び(`order by name, id`)。単位(Q1)は SQL でも並べて 500 で切るが、最終の並びは芯(UTF-16 の順)。500 種類を超えるときだけ、同じ数の境目で切られる単位が芯の並びと食い違いうる。ローカルの照合順序は `C`、本番(Neon)のデータベースの照合順序は UNKNOWN(名前の順が UTF-16 の順と変わりうる)。
5. 単位の結び `nullif(b.unit_type, '') is not distinct from u.unit` は見積もりが 100 分の 1 になる(8,500 行を 85 行と見る)。この規模では計画は崩れていないが、単位の Box がさらに増えて計画が崩れるときは、`coalesce` の鍵で等号にする(ハッシュで結べる)。
6. S の量: 芯の `UnitFacts.sheets` が S の全部を求めるので、Q2c は単位ごとに S をすべて返す(V2 で 1,980 行)。上限は 消していないシートの数 × 出す単位の数(6)。
7. 期間は 列の月(column_coord)とシート全体の月(sheet_coord)だけ。行に月があるシート(record_coord)は数えない(作業指示どおりの制約。scale.sql の 500 枚はこれに当たり、期間には入らない)。
8. Q4 は定義の jsonb をそのまま返す。定義が大きくなったら、`rows`・`columns`・`filters[].dimensionId`・`sources` だけに絞って返すと軽くなる(芯の `dimensionsOf`・`sourcesOf` が見るのはそこだけ)。
9. Task の 5,000 行で切るときの並び(`f.title, f.id, s.title, s.id`)は仮。芯の `buildTaskOverview` が並べ直すので、5,000 行を超えたときにどのシートが入るかだけが変わる(決めるのは W2/W3)。件数は一覧と同じ「最後の取り込み」(`order by started_at desc, id desc limit 1`)で数え、一覧の Task の数と一致することを確かめている(この規模で 108 件。superuser で別の書き方で数えた数とも一致)。
10. 取り込みの `error` の文は選んでいない(返さない)。

## 流し方(手元の使い捨てデータベースだけ)

```bash
# 0001〜0005(と 0006)を流したデータベースに、superuser で
psql -v ON_ERROR_STOP=1 -f test/scale.sql                       # 約 3 分
psql -v ON_ERROR_STOP=1 -v variant=V1 -f test/scale_home.sql    # 1 回目は約 80 秒。2 回目からは V1・V2 の切り替えだけ
# 0007 のあり・なしは superuser で migrations/0007_value_calculated_index.sql / .down.sql を流して切り替える
FOURDB_SCALE_APP_URL=postgres://fourdb_scale_app@localhost:55432/<db> npx vitest run src/fourdb/adapters/postgres/home.scale.test.ts --silent=false
# FOURDB_SCALE_EXPLAIN=1 で、50ms を超えたもの・目安を超えたものの EXPLAIN (ANALYZE, BUFFERS) も出す(=all ですべて)
```
