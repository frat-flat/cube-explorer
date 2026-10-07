# 4D Base データモデル(Canonical Data Model)

Status: 案(ユーザーの承認待ち)
Date: 2026-10-08
位置づけ: [DECISIONS.md](./DECISIONS.md) D-003 の「1. 芯の境界と Canonical Data Model」。表の定義は [0001_core.sql](../../src/fourdb/adapters/postgres/migrations/0001_core.sql)(元に戻すときは [0001_core.down.sql](../../src/fourdb/adapters/postgres/migrations/0001_core.down.sql))。

このモデルは、どの組み込み先(この Next.js アプリ、将来の Synapse)でも同じ形で使う「芯」の表です。素の PostgreSQL 15 以上だけで動き、拡張も、Neon や Supabase に固有の機能も使いません(D-004)。

---

## 1. 置き場所(芯・つなぎ・入れ物)

| 場所 | 中身 | 決まり |
|---|---|---|
| `src/fourdb/core/` | 芯の型と処理(取り込みの決まり、集計・投影) | Next.js・React・ログインの仕組み・Neon/Supabase のライブラリ・`adapters` を読み込まない。最初の芯のコードを置くとき(D-003 の 2)に、ESLint で自動チェックする |
| `src/fourdb/adapters/postgres/` | 表の定義(migrations)と、その確認(test) | 素の PostgreSQL。表はすべて名前空間 `fourdb` |
| `src/fourdb/adapters/google-sheets/` | スプシの読み取り(今の `src/lib/google/sheets.ts` を移して広げる) | D-003 の 2 で作る |
| `src/app/` ほか | 入れ物(画面・API・ログイン) | 実行用の役割で接続し、「誰のデータか」を芯へ渡す(3.9) |

## 2. 全体の形

```
workspace(誰のデータか)── workspace_member(入れ物の利用者 principal と役割)
 ├─ box(A社・楽天店などの実体。親子)                     … box_tree(ビュー: 深さ)
 ├─ dimension(軸: 月・店舗 …)── dimension_member(軸の値。親子: 年›四半期›月、法人›店舗)
 │                               └─ member_ancestor(段をまたいでまとめるための祖先の一覧)
 ├─ column_definition(Column Registry のカラム)── column_group / alias(呼び名)/ relation(関係)
 ├─ source_container(スプシ・貼り付け・4D Base での入力)
 │   └─ source_sheet(タブ。移行中/移行完了)── sheet_coord(表全体の軸の値)
 │       ├─ source_column(元の列と、その意味)── column_coord(列の軸の値)
 │       ├─ record(元の行)──────────────────── record_coord(行の軸の値)
 │       │   └─ value(セル = 行 × 列 の値。版つき)
 │       └─ import_run ── import_row(読み取ったけれど、まだ反映していない分 = Saving)
 ├─ history(履歴)
 └─ card_attribute(ビュー: Box の属性 = Card)
```

## 3. 大事な決め方と理由

### 3.1 セル = 行 × 列。意味は「表・行・列」に持たせ、値には持たせない
- 値(`value`)は「どのタブの、どの行(`record`)の、どの列(`source_column`)か」と、数値・文字だけを持ちます。行と列が同じタブのものであることは、データベースが確かめます。
- 「何の値か(売上・月・店舗)」は、列・行・表の側に持たせます。
- 理由: 列の意味を承認し直しても、数百万の値を書き換えずに済みます。また、どの値も「元のスプシのどのセルか」(行番号 × 列番号)が必ず分かります(② 30章-5 由来を失わない)。

### 3.2 軸の値は「表全体 → 行 → 列」の順に決まる(後ろが優先)
例: タブ「楽天」の表で、行が「S-01」、列が「1月」の売上のセル

| どこに持つか | 表 | 持つもの |
|---|---|---|
| 表全体 | `sheet_coord` | モール = 楽天(タブ名や、表が属する Box から) |
| 行 | `record_coord` | 店舗 = S-01 |
| 列 | `column_coord` と `source_column.column_definition_id` | 月 = 2026-01、項目 = 売上 |

→ このセルの値は「売上 / S-01 / 楽天 / 2026-01」。「横に並んだ月」は、列ごとに月を持たせることで表せます(① 付録の 2)。
- 軸の値の組は、1つの軸に1つの値です。入れられるのは「同じ workspace の、その軸の値」だけで、別の人の値や別の軸の値は入れられません(データベースが確かめる)。
- 使われている軸の値は消せません。
- 同じ軸が表・行・列の2か所以上に入っているときは承認の段階で止めます(D-003 の 2 で作る)。

### 3.3 合計は値にしない(② 30章-2)
- 合計・小計の行は `record.kind = aggregate`、合計の列は `source_column.role = aggregate`(関数名つき)にします。データベースが、そこに値を入れることを拒否します。
- スプシに書かれていた合計の数字と関数は残しておき、Cell Inspector で「スプシの合計」と「4D Base で計算した合計」を見比べられるようにします(D-003 の 5)。
- 年合計・全店舗合計を「13番目の月」「4つ目の店舗」として軸の値にすることはありません。

### 3.4 計算された値は Raw と分ける(② 30章-3)
- スプシの関数で計算されたセル(例: 精算額 = 売上 − 経費)は `value.kind = calculated` にして、元の関数を `formula` に残します。
- 計算された値は 4D Base で直せません(データベースが拒否)。計算の系譜(Semantic Formula)は後の段階で作ります。

### 3.5 時間は「期間を持つ軸の値」
- 月・四半期・年は、時間の軸(`semantic_type = time`)の値で、それぞれ期間(`period_start`〜`period_end`)を持ちます。
- 段は親から自動で決まり(年 0・四半期 1・月 2)、軸に決めた段の数を超えられません。親は子より先に作ります。
- 段をまたいだまとめ(月 → 四半期 → 年、店舗 → 法人)は `member_ancestor` を使います。軸の値を作ると自動で入り、軸の値の親・段・所属はあとから変えられません(祖先の一覧が古くならないように)。名前は直せます。
- T(時間を流して見る)と、T を XYZ に並べる操作(D-003 の 10)は、同じ時間の軸の値を使います。
- 数値の値には期間(`valid_from`・`valid_to`)を付けません。時間は軸で表します。

### 3.6 値の版(D-002)
- 値は「いつ記録したか」(`system_from`)と「いつ別の版に置き換わったか」(`system_to`)を持ちます。今の値は `system_to` が空のものです。
- 4D Base で直すと、前の版を閉じて新しい版を足します。元の値・直した値・日時・直した人がすべて残ります。版の中身は書き換えられません(閉じることだけができる)。
- データベースが次を確かめます:
  - 4D Base で直せる(`origin = manual`)のは、移行完了(`migration_status = migrated`)の表の Raw の値だけ
  - スプシから取り込める(`origin = import`)のは、移行中の表だけ
  - 今の値は1つのセルに1つ。属性(Card)の値は期間が重ならない
- 移行中の表を読み直したときに値が変わっていれば、同じように版を足します。スプシ側でいつ何が変わったかも残ります。

### 3.7 Card(D-001)
- Card の属性は、Box を表す行(`record.box_id`)の、属性の列(`role = attribute`)の値です。期間(`valid_from`〜`valid_to`)と元を持ちます。
- `card_attribute` というビューで、② 5章の形(`box_id`・`attribute_definition_id`・`value`・`valid_from`・`valid_to`・`source_reference`)で見られます。

### 3.8 4D Base で入力したデータも同じ形
- 移行完了のあとに 4D Base で足した行・Card の属性は、`provider = native` の元(4D Base の中の表)に入れます。
- スプシから来た値も、4D Base で入力した値も、すべて「行 × 列」の同じ形になります。由来は `value.origin`(import / manual)で分かります。

### 3.9 誰のデータか(守り方は3重)
1. **子は同じ workspace の親しか指せない**: すべての表に `workspace_id` を持ち、子は (workspace_id, 親の id) で親を指します。処理の誤りで別の人の行を指そうとしても、データベースが拒否します。
2. **行ごとの権限(RLS)を全表で強制**: 処理はトランザクションごとに `fourdb.workspace_id` を設定してから読み書きします。設定した workspace の行しか見えず、書けません。設定がなければ何も見えません。表の持ち主の接続でも強制されます。
3. **入れ物は実行用の役割で接続する**: 表の持ち主でも、行ごとの権限を飛ばせる役割(superuser・BYPASSRLS)でもない役割で接続し、必要な権限だけを渡します。役割の作り方は組み込み先ごとに決めます([ENVIRONMENT.md](../deployment/ENVIRONMENT.md))。

- `workspace_member` だけは、workspace を決める前でも「自分(`fourdb.principal`)の所属」を引けます。
- principal は入れ物が決める**変わらない印**にします(例: `neon:<ユーザー ID>`)。メールアドレスは持ち主が変わりうるので使いません。
- 関数・表・ビューは、誰にも(PUBLIC)渡していません。ビューは呼んだ人の権限で動きます(`security_invoker`)。
- 今は1人に1つの workspace。共有はあとから `workspace_member` を足すだけです(この環境の決定)。

### 3.10 消すとき
- 表(タブ)とスプシは `deleted_at` を入れて隠します(論理削除)。
- 移行完了した表は物理削除できません。4D Base で直した値の履歴を失わないためです(② 26章「削除時も履歴を残す」)。
- workspace ごと消すときだけは、中身(移行完了の表・使われている定義を含む)がすべて消えます。

### 3.11 ID
- 定義の表(Box・軸・カラムなど)は uuid。別の組み込み先とデータを合わせるときにぶつかりません。
- 数が多い表(列・行・値)は連番(bigint)。値1つあたりの大きさを抑えます。

### 3.12 取り込み(Saving)
- 読み取った元のセルは `import_row` に置き(= Saving)、承認して反映するまで値にしません(① 30章「Import 前に人間が承認する」)。
- `import_run.cursor` に次に読む範囲を残し、途中で止まっても続きから読めます(D-006)。同じ表の取り込みは同時に1つだけです。
- 反映したら `import_row` は消します(元のセルの中身には個人情報が含まれうるため、残し続けない)。

## 4. ② 技術設計の Entity との対応

| ② の Entity | このモデル | いつ作るか |
|---|---|---|
| SourceContainer・SourceSheet・SourceColumn・Record・Value | 同名の表 | 今回 |
| Box | `box`(深さは `box_tree`) | 今回 |
| Card | `card_attribute`(ビュー。値は `value`) | 今回 |
| ColumnDefinition | `column_definition`(+ `column_group`・`alias`) | 今回 |
| Dimension・DimensionMember | `dimension`・`dimension_member`(+ `member_ancestor`) | 今回 |
| Value の entity・dimension_members | `record.box_id`、`sheet_coord`・`record_coord`・`column_coord` | 今回 |
| Relation | `relation`(今はカラム同士・Box 同士) | 今回 |
| History | `history`(値ごとの前後は `value` の版) | 今回 |
| Snapshot | 読み取りの記録は `import_run`、値の前後は `value` の版 | 今回 |
| Aggregation | 取り込みで見つけた合計は `record.kind`・`source_column.role`。表示の合計の定義は SheetDefinition の中 | D-003 の 3・4 |
| SheetDefinition | 後で足す | D-003 の 4 |
| Selection・DrillContext | 後で足す | D-003 の 7 |
| CubeDefinition・AxisConfiguration | 後で足す | D-003 の 8 |
| ViewState | 後で足す | D-003 の 7・8 |
| Calculation・LineageEdge | 後で足す。今は `value.kind = calculated` と `formula`、元のセル(行 × 列)と `history` | 後に回すもの |

## 5. 今の画面のデータとの対応(参考)

本番のデータは移行しません(この環境の決定)。今の画面の考え方が、新しい表のどこに当たるかだけを示します。

| 今(`public/sheets/axes.html` の `S`) | 新しい表 |
|---|---|
| `axes`(Column Registry のカラム) | `column_definition`(分類の軸は `dimension` も) |
| `groups` | `column_group` |
| `dict`(呼び名 ＝ ≒ ⊃ ⊂) | `alias` |
| `links`(Equivalent・Related・参照) | `relation` |
| `boxes`(Box) | `box` |
| `boxes`(Cube) | `box` と、後の CubeDefinition |
| `sheets`(取り込んだ表のコピー) | `source_sheet`・`source_column`・`record`・`value`(コピーではなく元そのもの) |
| `cards` | Box の行の属性の値(`card_attribute`) |
| `saved`(Remix の条件) | 後の SheetDefinition |
| `saving` | `import_run`・`import_row` |
| `history` | `history` |

## 6. 確かめたこと(2026-10-08、手元の使い捨てデータベース PostgreSQL 18)

### 決まり([0001_core.check.sql](../../src/fourdb/adapters/postgres/test/0001_core.check.sql)、60 項目すべて通過)
拒否されたものは、すべて狙った理由で拒否されたことを、エラーの内容で確かめています。
- **workspace をまたがない**: 別の workspace の親を指す行・軸の値・Box・タブ・セルの値は拒否。行の軸の値に別の人の値を入れるのも拒否。行ごとの権限で、設定した workspace の行しか見えず(Card のビューも)、別の workspace へは書けない。設定がなければ何も見えない
- **軸の値**: 段は親から決まる / 別の軸の値を親にできない / 同じ文で子を親より先に入れられない / 段の数を超えられない / 親・所属を変えられない(名前は直せる)/ 使われている値は消せない / 店舗の軸に月の値を入れられない
- **Box**: 深さが数えられる / 自分の子孫の下へ移せない(輪にならない)
- **列**: 合計の列には関数が要る / 数値・属性・分類の列には意味が要り、種類が合っていなければ拒否 / 使わない列は意味を持たない / 同じ位置に今の列は1つ
- **値**: 合計の行・合計の列・使わない列には入れられない / 行と列は同じタブ / 同じセルに今の値は1つ / 属性の期間は重ならない / 数値に期間は付けない / 計算値には関数が要る / 空の値は入れない / 版は書き換えられない
- **移行**: 移行中の表は 4D Base で直せない / 移行完了の表へはスプシから取り込めない / 移行完了の表は直せ、同じトランザクションで2回直しても版が3つ残り今の値は1つ / 移行完了の表は物理削除できず、隠すことはできる
- **集計**: 年でまとめた合計に、合計の行・列が入らない(直す前 300、直したあと 360)
- **その他**: 貼り付けの元を複数作れる / 同じタブは2重に登録できない / 同じ表の取り込みは同時に1つ / workspace ごと消せ、別の workspace は残る / すべての表で行ごとの権限が強制され、すべてのビューが呼んだ人の権限で動き、関数は誰にも渡していない
- 元に戻す手順([0001_core.down.sql](../../src/fourdb/adapters/postgres/migrations/0001_core.down.sql))で表がすべて消えることも確かめた

### 規模([scale.sql](../../src/fourdb/adapters/postgres/test/scale.sql)・[scale_queries.sql](../../src/fourdb/adapters/postgres/test/scale_queries.sql)、架空のデータ)
法人 500 × 店舗 16 = 8,000 店舗 × 36 か月 = **行 288,000・値 2,880,000**(数値の項目 10)。集計は、入れ物の実行用の役割で、行ごとの権限がかかった状態で測った(2回目の値)。

| 確かめたこと | 結果 |
|---|---|
| 容量(索引込み) | 全体 865MB(値 612MB・行 126MB・行の軸の値 117MB) |
| 値 288 万個の書き込み(決まりの確かめ込み) | 約 2 分(実際の取り込みは分割して行う) |
| 全法人 × 年 で1項目をまとめる(値 28.8 万個) | 約 0.8 秒 |
| すべての項目を 四半期 × 項目 でまとめる(値 288 万個) | 約 1.1 秒 |
| 1つの法人の 16 店舗 × 12 か月(Sheet の1画面分) | 約 0.06 秒 |
| 1つの店舗 × 月 | 約 0.04 秒 |
| 表を1枚消す(行 576・値 5,760 もいっしょに) | 約 0.03 秒 |
| workspace を設定しないで値を読む | 0 件 |

手元のパソコンでの値です。クラウドのデータベースでは遅くなる可能性があります(未確認)。全体をまとめる集計を画面で何度も使うようになったら、② 24章の Cache を使います。

### 別の立場での確認
DB 担当とセキュリティ担当の AI が、この表の定義を確認しました。最初の案に対する指摘(workspace を消せない、軸の値の組に別の人の値を入れられる、値が別のタブの列を指せる、軸の値の段の矛盾で二重に数える、Box の輪、属性の期間の重なり、合計の行への書き込み、移行完了の表の物理削除、持ち主の接続で行ごとの権限が効かない など)は、すべてこの版で直し、上の 60 項目で確かめています。

## 7. 容量と費用の見込み

- 値1つあたり約 300 バイト(行と軸の値の分、索引込み)。数十万行 × 10 項目で約 0.9GB、100 万行 × 10 項目で約 3GB の見込みです。
- 多くのデータベースの無料枠(0.5GB 程度)を超えます。本番にこの表を作る前に、置き場所(Supabase か Neon か)と料金プランを決める必要があります(ユーザーの判断。最新の料金表で確認してから相談する)。
- 小さくする余地: 種類を表す列(`kind`・`origin`)を小さい型にする、値の `id` をなくす、などで2〜3割。必要になってから行います。

## 8. 後の段階で決めること

- 行の同一性(`record.row_key`)の決め方: 承認のときに「行を見分ける列」を選ぶ形にする(D-003 の 2)。
- 軸の値(法人 = A社)から Box を自動で作るか: 取り込みの画面と一緒に決める(D-003 の 2)。
- 同じ軸が表・行・列の2か所以上に入ったときの扱い: 承認の段階で止める(D-003 の 2)。
- 列の意味を承認し直したときの履歴の残し方(D-003 の 2)。
- 外部へ出すとき(② 28章)に出さない列(直した人・元のセルの場所など): 書き出しを作るときに決める。
- 本番のデータベースの置き場所と料金プラン(上の 7)。
