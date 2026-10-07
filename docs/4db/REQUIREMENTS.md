# 4D Base 要件定義書

Version: 0.1
Date: 2026-10-08
Status: Draft / Current Concept

> この要件定義書は DESIGN.md より優先する。DESIGN.md の古い章(RDB 直結・3軸固定の Cube など)と食い違う場合はこちらに従う。
> 実装の順番と、まだ決まっていないことは末尾の「付録: 実装の進め方(総評より)」を参照。
> 2026-10-08 以降のユーザーの決定(Card の扱い、スプシからの移行の切り替え、実装の順番など)は [DECISIONS.md](./DECISIONS.md) にある。付録の「未決」のうち決まったものと、実装の順番はそちらが新しい。

---

# 1. プロダクト概要

4D Base は、Google Spreadsheet 等に分散している業務データを読み込み、

- 値
- 意味
- 所属
- 属性
- 階層
- 計算
- 参照
- 集計
- 分配
- 時間
- データの由来

を、セルの物理的な位置から切り離して管理する Data Bank である。

内部ではデータ同士の関係を保持しながら、

- Box
- Card
- Sheet
- Cube

という複数の表現方法から同じデータを観測できるようにする。

Cube は XYZ の最大3つの空間軸と、時間 T を利用して多次元的にデータを観測できる。

ただし、XYZT の意味はシステム全体で固定しない。

ユーザーは目的に応じて、

- 軸の追加
- 軸の削除
- 軸の交換
- 軸の固定
- 軸の縮約
- Dimension の変更
- 粒度の変更
- 時間の空間軸への展開

を行える。

また、多くの利用者は表形式に慣れているため、Cube を利用しなくても Sheet だけで日常業務を行えることを重要要件とする。

---

# 2. 解決する問題

現在の Spreadsheet 運用では、データの意味・計算・表示位置が強く結合している。

例：

A | B | 合計(A+B) | C | D | 合計(C+D)

この構造では、

- 合計列が途中に入ることでオートフィルしにくい
- 明細と集計値が同じ軸上に混在する
- 月次データと年合計が同列に存在する
- 別ファイルから IMPORTRANGE 等で引用する必要がある
- 計算元を追跡しにくい
- ファイルを跨いだ関係が分かりにくい
- 同じデータを別の切り口で見るために別Sheetを作る必要がある
- 表を作り直さないと行列を交換できない
- 内訳を見るために別Sheetへ移動すると元の合計値が分からなくなる

という問題が発生する。

4D Base は、「データそのもの」と「データの見せ方」を分離することでこれを解決する。

---

# 3. 基本原則

## 3.1 Source of Truth

同一データを複数箇所へコピーして管理しない。データは可能な限り一つの Source を持つ。別の Box / Sheet / Cube から利用するときは Reference として参照する。

## 3.2 表示位置とデータ意味を分離する

「AB列にあるから8月」のように、セル位置そのものをデータ意味にしない。内部では Entity / Dimension / Metric / Time / Attribute / Relation 等として意味を保持する。

## 3.3 集計値とDimension Memberを分離する

1月〜12月と年合計がある場合、「年合計」を13番目の月として扱わない。年合計は `Aggregation(Time = Jan..Dec, Function = SUM)` として扱う。同様に、A店舗・B店舗・C店舗・全店舗合計の場合、全店舗合計を4店舗目として扱わない。

## 3.4 Data と View を分離する

同じ Data Bank を Sheet / Cube / Box から異なる方法で観測できる。View を変更しても Source Data は変更しない。

---

# 4. 基本オブジェクト

## 4.1 Box

意味のある実体またはまとまり(A社・楽天店舗・Yahoo店舗・代理店 など)。内部に Box / Sheet / Cube を持て、階層構造を形成できる(A社 ├ 楽天店舗 └ Yahoo店舗)。

## 4.2 Card

Card は Box の「面」に相当する属性情報。独立した業務データ一覧ではなく「その Box が何者か」を表す(例: A社 — 法人・課税事業者・8月決算・契約者・楽天店舗あり)。検索・分類・Filter にも利用できる。

## 4.3 Sheet

人間が日常的に情報を確認・操作・共有するための2次元表現。Source Data だけではなく、以下の2種類を許容する。

- Source Sheet: 取り込んだ元表
- Projected Sheet: Data Bank / Cube / Selection 等から必要な情報を表形式へ投影したもの

Sheet は Data Lineage を保持する。

## 4.4 Cube

データを最大 XYZ の3空間軸と T の時間軸から観測する多次元View。固定されたデータContainerではなく、Data Bank に対する Projection として扱う。Sheet / Box / Source Data / 他Cube 等を参照可能。Cube → Cube の場合でも最終的な Source まで Data Lineage を追跡可能にする。

---

# 5. Axis仕様

Cube は最大 X / Y / Z / T の Axis Slot を持つ。XYZ の意味は固定しない。

例: X = 精算額、Y = 法人、Z = 内訳、T = 月。別Cubeでは X = 法人情報、Y = 法人、Z = 契約、T = 申込日時 でもよい。

# 6. Axis / Role / Dimension の分離

- Axis: 表示上の方向(X / Y / Z / T)
- Role: その軸が現在どの役割を持つか(Measure / Entity / Breakdown / Time / Attribute / Status / Hierarchy)
- Dimension: 実際に割り当てられているデータ(法人 / 店舗 / 月 / 売上種別 / 契約状態)

Axis ≠ Role ≠ Dimension とする。

# 7. Axis操作

- Swap: X↔Y、Y↔Z、X↔Z
- Replace: Z = 店舗 → Z = 売上種別
- Slice: 特定値へ固定(店舗 = 楽天)
- Hide: Dimension は保持したまま表示のみ隠す
- Drop / Roll-up: Dimension を集約し軸を外す(楽天 + Yahoo → 法人合計)
- Add Dimension: 2D → 3D
- Remove Dimension: 3D → 2D

# 8. Time仕様

T は時間Dimension用の特別な観測Slot。T を変更するとその時点の XYZ 空間を表示する。Time Dimension は XYZ へ移動可能(T = Month → Z = Month で複数月を空間上に展開)。T = 時間を流して見る、XYZ上のTime = 時間を並べて比較する、の2つの観測方法を持つ。

# 9. Scale / Granularity

Dimension と Scale を分離する。Time: 日→月→四半期→年。Organization: 店舗→法人→代理店→全体。Sales: 明細→項目→カテゴリ→店舗売上→法人売上→全体売上。大量データをすべて同時表示せず、データを削減せずに観測解像度を変更する。

# 10. 点・線・面・立体

固定データ型ではなく、選択中の Dimension 数・Scale・Selection によって変化する。点 = A社×楽天×2026年8月、線 = A社×楽天×2026年1〜12月、面 = 全法人×楽天×2026年1〜12月、立体 = 全法人×全店舗×2026年1〜12月。

# 11. Selection

Selection を一級オブジェクトとし、「現在選択しているデータ空間の範囲」を表す。範囲: 1セル・横・縦・矩形・複数範囲・Cube上の点/線/面/領域。Entity / Dimension / Metric / Time Range / Filter / Source / Value / Aggregate Value 等を保持できる。

# 12. Drill-down

選択したデータ範囲の下位内訳へ観測対象を移す操作。単一セルに限定しない(2026年1月〜12月を選択して Drill-down できる)。

# 13. Context Preservation

Drill-down しても親Contextを失わない。Root Value / Parent Value / Current Value / Selection Range / Filter / Time Range を常時表示し、必要に応じて構成比も表示する。

# 14. Value Breadcrumb

各階層の値を含むパンくず(精算額 15,496,654 > 売上 18,000,000 > 商品売上 16,500,000 > 注文)。任意階層へ直接戻れる。

# 15. Drill Axis

複数セル・期間を Drill-down する際、次に何を内訳として展開するか(月・店舗・売上項目・経費カテゴリ・商品・注文)を選択可能とする。

# 16. Aggregation

最低限 SUM / COUNT / AVG / MIN / MAX。Aggregation は元 Dimension Member と分離し、Subtotal / Grand Total も Aggregation として管理する。

# 17. Calculation

Raw Value と Calculated Value を区別する(売上・経費 = Raw、精算額 = 売上 − 経費 = Calculated)。計算結果には Data Lineage を保持する。

# 18. Data Lineage

Origin / Relation / Transform / Aggregation / Projection を追跡可能にする(例: VALUE 1,478,317 / ORIGIN A社 / Yahoo / 2025-08 / TRANSFORM 売上 − 経費 − 手数料 / AGGREGATION SUM / PROJECTION 店舗売上Sheet 2025年8月セル)。

# 19. Relationの種類

混同しない: Hierarchy(中に何があるか: A社 → 楽天店舗)、Semantic Relation(意味的な関係: 会社名 = 法人名)、Data Lineage(値の流れ: A店舗売上 → 総合店舗売上)。

# 20. Gather / Aggregate

複数Sourceを統合可能にする(A店舗・B店舗・C店舗 → 総合店舗。全法人の楽天店舗 × 2026年8月を各法人Boxから横断取得)。

# 21. Split / Distribute

1つのSourceを条件によって複数Viewへ分配できる(総合店舗 → 法人=A → A店舗 …)。データはコピーせず Reference として扱う。

# 22. Source of Truth

双方向同期を無条件に許可しない。Source(値を所有)/ Reference(Sourceを参照)/ Derived(Sourceから計算)を明示する。

# 23. Sheet View

Sheet は日常利用における中心View。Cube を利用しないユーザーでも、Data Bank から必要な情報を自動的に集めた表を利用できること。Sheet 上でも Raw / Calculated / Subtotal / Grand Total / Reference を視覚的に区別する。色だけに依存せず Σ・アイコン・罫線・ラベル等も併用する。

# 24. Cell Inspector

Sheet 上の値を選択すると Value / Type / Semantic Formula / Technical Formula / Source / Breakdown / Lineage / Aggregation / Filters を確認できる。

# 25. Semantic Formula

Technical: `SUM(AB4:AM4)` → Semantic: `SUM(Entity = A社, Store = Yahoo, Metric = 精算額, Period = 2025)`

# 26. Sheet Definition

Projected Sheet は表示結果だけでなく Definition を保存する(Name / Rows / Columns / Measure / Filter / Aggregation / Subtotal / Grand Total / Sort)。

# 27. Sheet / Cube 相互変換

Sheet → Cube、Cube → Sheet を可能にし、Data Lineage を失わない。同じデータから複数 Sheet / Cube を生成可能。

# 28. 外部共有

顧客への共有は主に Google Spreadsheet を想定。Cube をそのまま顧客へ共有することを前提としない。必要な情報を Sheet として出力し、出力時にも Raw / Calculated / Subtotal / Grand Total を視覚的に区別する。内部 Lineage は 4D Base 側に保持する。

# 29. Import

Google Spreadsheet を Source として読み込む(Spreadsheet ID → Source Container → Sheet → Column → Record → Value)。Spreadsheet ID を内部のデータ境界とはせず、複数 Spreadsheet を跨いで Relation を作成可能とする。

# 30. 既存思想として維持するもの

- Sheetを重要な中心Viewとする
- 元Spreadsheetを勝手に変更しない
- Import前に人間が承認する
- Savingを持つ
- LibraryとColumn Registryを分離する
- Alias / Equivalent / Related
- DrillとFilterを分離する
- World
- Compose(Create / Import / Remix)
- 履歴
- 実データのみ。ダミーデータを本番へ置かない
- 初期設定を勝手に決めない

# 31. 4D Baseの設計原則

データを固定された表の行・列に閉じ込めない。値・意味・関係・計算・階層・時間を保持したまま、Boxで整理し、Cardで属性を持たせ、Sheetで日常的に確認・共有し、Cubeで任意のDimensionから再構成する。ユーザーは観測する単位と軸を選択し、点・線・面・立体としてデータを展開できる。XYZは追加・交換・固定・縮約でき、時間Tから状態変化を観測できる。任意のSelectionからDrill-downでき、親Contextを保持したまま内訳を探索できる。結果はData Lineageを維持したままSheetとして出力できる。

---

# 付録: 実装の進め方(総評より、2026-10-08)

最初のゴールは「スプシの合計列の問題が解けること」。そこまでで Sheet だけの利用者にも価値が出る。

| 順 | 作るもの | 章 |
| --- | --- | --- |
| 1 | Data Bank の土台(値ごとに意味と元のセルを持つ。Supabase に表を分けて保存) | 3.1・3.2・29 |
| 2 | Import で「横に並んだ月」と「合計列・合計行」を分け、Saving で承認(SUM などの関数を合計の候補にする) | 3.3・16 |
| 3 | Projected Sheet(行・列・値・絞り・合計の定義を保存、Σ で合計を区別) | 23・26 |
| 4 | Cell Inspector の最小版(値・元のセル・合計の中身) | 24・18 の Origin |
| 5 | Drill と値つきパンくず | 12〜14 |
| 6 | Cube の XYZ を Role つきで入れ替え(Swap・Replace・Add・Remove) | 5〜7 |
| 7 | T(データの日付)と、T を XYZ に展開 | 8 |

後に回すもの: 計算の系譜(Transform・Semantic Formula)、Gather / Split、Scale の自動切り替え、複数範囲の Selection、スプシへの書き出し。

今の実装(public/sheets/axes.html)との食い違い:

- 保存はログインした人ごとに1件の JSON(Supabase の cube_workspaces)。1 の Data Bank は作り直しになるので、今の Box・Sheet の中身を新しい形へ移す手順も一緒に決める。
- Sheet は今 1つの Cube に属する(sheet.cube)。Reference にするには Cube 側が使う Sheet の一覧を持つ形へ変える。
- Library の種類(assignDefs)は、単位のない Cube を3軸の組み合わせで分類している。軸を自由に入れ替えると種類が変わるので、元の Sheet で決める形に変える。
- Card は今「行から作る独立した札」。4.2 の「Box の面 = 属性」にそろえるかは未決。
- スプシの読み取りは閲覧のみの権限(spreadsheets.readonly)、1タブ先頭300行×26列。28 の書き出しには書き込み権限が要る(書くのは新しいスプシだけにする想定)。

未決:

- 最初に作る範囲を上の 1〜7 で確定してよいか
- Card の扱い(Box の属性にそろえるか、今の独立した札を残すか)
- 誰が使うか(自分だけか、社内で共有するか)と、扱う量の目安
