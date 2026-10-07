# 4D Base Development Instruction

> Claude Code 向けの開発指示書(どの組み込み先でも共通)。以下はユーザーから受け取った本文(2026-10-08)のまま。
> 「PHASE 20 — IMPLEMENTATION ORDER」は、2026-10-08 のユーザー決定で [DECISIONS.md](./DECISIONS.md) の D-003 の順番に置き換えた(取り込みの改善と、4D Base 内での修正を追加)。
> 「FIRST RESPONSE REQUIRED」の報告は [../deployment/AUDIT-2026-10-08.md](../deployment/AUDIT-2026-10-08.md)。

あなたは4D Baseの既存コードベースを改修する。

この指示を受け取った時点では、いきなり実装を開始してはいけない。

既存実装を破壊せず、
現在のコード・既存設計・新要件を照合したうえで段階的に移行すること。

---

# PHASE 0 — THINKING RULE

思考・内部分析は英語で行う。

ユーザーへの報告・質問・仕様確認は日本語で行う。

推測で仕様を確定しない。

---

# PHASE 1 — CURRENT STATE AUDIT

最初にRepository全体を調査する。

確認対象：

- README
- DESIGN.md
- CLAUDE.md
- migrations
- schema
- Supabase
- Neon Auth
- API
- routes
- components
- hooks
- stores
- services
- types
- tests
- existing Cube
- existing Box
- existing Sheet
- existing Card
- Library
- Column Registry
- Saving
- Compose
- World
- History

現在実装されているデータモデルを特定する。

---

# PHASE 2 — SPEC DIFF

既存仕様と新仕様を比較する。

以下の3分類で報告する。

KEEP
既存のまま利用可能。

MODIFY
変更が必要。

ADD
新規実装が必要。

特に確認する：

- Box
- Card
- Sheet
- Cube
- Source
- Relation
- Calculation
- Aggregation
- Lineage
- Dimension
- Axis
- Scale
- Selection
- Drill
- Time
- Projection

---

# PHASE 3 — BLOCKER CHECK

実装前にMIGRATION BLOCKERを洗い出す。

既存データを壊す可能性がある変更はBLOCKER扱い。

特に、

- DB Schema変更
- ID変更
- 既存Relation変更
- Source Data移行
- Sheet Definition変更
- Cube Definition変更

を確認する。

BLOCKERがある場合は実装せず報告する。

---

# PHASE 4 — ARCHITECTURE PLAN

以下のLayerへ整理する計画を作成する。

Source
Semantic
Relation
Calculation
Lineage
Projection
Presentation

既存コードを最大限再利用する。

大規模Rewriteは禁止。

---

# PHASE 5 — CANONICAL DATA MODEL

UI実装より先にCanonical Data Modelを確定する。

最低限検討するEntity：

SourceContainer
SourceSheet
SourceColumn
Record
Value

Box
Card

ColumnDefinition
Dimension
DimensionMember

Calculation
Aggregation

Relation
LineageEdge

SheetDefinition
CubeDefinition

AxisConfiguration
Selection
ViewState

Snapshot
History

ただし既存Schemaと重複する場合は新規作成せず統合する。

---

# PHASE 6 — PROJECTION ENGINE

SheetとCubeで共通利用するProjection Engineを設計する。

Input:

source
dimensions
filters
scale
aggregation
selection

Output:

SheetProjection
CubeProjection

計算ロジックをSheet/Cubeへ重複実装しない。

---

# PHASE 7 — SHEET FIRST

最初のUI実装はCube 3DよりSheetを優先する。

理由：

現在の実運用はSpreadsheet中心であり、
Projection Engine・Calculation・Lineageの検証を2Dで行う方が容易なため。

実装：

- Sheet Definition
- Rows / Columns
- Filter
- Aggregation
- Subtotal
- Grand Total
- Raw / Calculated表示
- Cell Inspector
- Lineage表示
- Selection

---

# PHASE 8 — SELECTION

SelectionをSheet固有実装にしない。

共通Selection Modelとして実装する。

対応：

single cell
row range
column range
rectangle
multi selection

内部的にはDimension Member Selectionへ変換する。

---

# PHASE 9 — DRILL

SelectionからDrill-down可能にする。

単一セル限定禁止。

例：

2026年1月〜12月を選択
↓
Drill
↓
内訳

Drill時には、

root value
parent value
current value
selection
filters
time range

を保持する。

Value Breadcrumbを表示する。

---

# PHASE 10 — AGGREGATION

SUM
COUNT
AVG
MIN
MAX

を実装可能な共通Aggregation Layerへ置く。

年合計や全店舗合計を通常Dimension Memberとして実装しない。

---

# PHASE 11 — CALCULATION & LINEAGE

Raw / Calculatedを分離する。

Calculated Valueについて、

- inputs
- expression
- result
- source
- lineage

を追跡する。

Cell Inspectorから逆引き可能にする。

---

# PHASE 12 — GATHER / SPLIT

Gather:

A店舗
B店舗
C店舗
→ 総合店舗

Split:

総合店舗
→ A店舗
→ B店舗
→ C店舗

をReference/Projectionとして実装する。

データコピーによる実装は禁止。

---

# PHASE 13 — CUBE

Sheet側のProjection Engineが安定してからCubeへ接続する。

Cubeは独自データStoreを持たない。

Projection Engineの結果をXYZへMappingする。

対応：

Axis Swap
Axis Replace
Slice
Hide
Roll-up
Add Dimension
Remove Dimension

---

# PHASE 14 — TIME

Time DimensionをT Slotへ割り当て可能にする。

さらに、

T → X/Y/Z
X/Y/Z(Time) → T

を可能にするデータモデルにする。

UIは後からでもよいが、Schemaを固定しすぎないこと。

---

# PHASE 15 — SCALE

大量データを3Dへ直接描画しない。

Cube表示前にデータ規模を評価する。

必要ならGranularityを上げる。

例：

店舗
→ 法人

月
→ 年

明細
→ Category

ユーザーの承認なしに業務データをRandom Samplingしない。

---

# PHASE 16 — SHEET/CUBE SWITCH

同じProjectionを、

Sheet
Cube

で切り替え可能にする。

切替時に、

Filter
Selection
Dimension
Time
Scale

を可能な限り保持する。

---

# PHASE 17 — EXTERNAL OUTPUT

Projected SheetをGoogle Spreadsheet等へ出力できる設計にする。

外部出力では内部機密情報を出さない。

ただし4D Base内部ではLineageを保持する。

---

# PHASE 18 — TESTING

各Phaseごとに以下を実施する。

Unit
Integration
E2E
Visual
console/network

特に確認：

- Selection範囲
- Drill Context
- Aggregation
- Calculation
- Lineage
- Axis交換
- Sheet/Cube切替
- Source更新
- Cross-Box Gather
- Split
- Permission leak

---

# PHASE 19 — NO DUMMY DATA

本番UIにダミーデータを入れない。

Test Fixtureのみ許可する。

---

# PHASE 20 — IMPLEMENTATION ORDER

推奨順序：

1. Existing Code Audit
2. Spec Diff
3. Migration Blocker
4. Canonical Data Model
5. Semantic / Dimension
6. Calculation
7. Aggregation
8. Lineage
9. Projection Engine
10. Sheet Definition
11. Sheet Projection
12. Selection
13. Drill
14. Cell Inspector
15. Gather / Split
16. Cube Definition
17. Axis Engine
18. Scale
19. T
20. Sheet/Cube Switch
21. External Output
22. World integration
23. Performance optimization

順序を変更する場合は理由を説明する。

---

# IMPORTANT

このプロジェクトの目的は
「Spreadsheetを3D化すること」
ではない。

目的は、

データをセル位置から解放し、

値
意味
関係
計算
階層
時間
由来

を保持したData Bankを作り、

必要に応じて

Box
Card
Sheet
Cube

として観測できるようにすることである。

Cubeは目的ではなくViewである。

Sheetも単なるExportではなく主要Viewである。

最終的に同じData Bankを、

点
線
面
立体
時間

の異なる解像度から観測できることを目指す。

---

# FIRST RESPONSE REQUIRED

この指示を受け取ったら、コード変更を開始せず、

1. 現在の実装構造
2. 新仕様との一致点
3. 新仕様との相違点
4. KEEP
5. MODIFY
6. ADD
7. MIGRATION BLOCKER
8. 推奨実装順序
9. 既存コードで再利用可能な部分
10. 仕様上まだ決める必要がある事項

を日本語で報告すること。

その報告をユーザーが承認するまで、
破壊的変更・DB migration・大規模refactorを開始しないこと。
