# 4D Base Technical Design

Version: 0.1
Date: 2026-10-08

> 4D Base の技術設計(どの組み込み先でも共通の芯)。要件は [REQUIREMENTS.md](./REQUIREMENTS.md)、ユーザーの決定は [DECISIONS.md](./DECISIONS.md)、進め方は [DEVELOPMENT.md](./DEVELOPMENT.md)。
> 以下はユーザーから受け取った本文(2026-10-08)のまま。

---

# 1. Architecture Principle

UI構造とデータ構造を分離する。

禁止：

Box / Sheet / Cube のUI階層を、そのままDBテーブル階層として実装すること。

内部ではCanonical Data Modelを持ち、
Box / Sheet / Cubeはそのデータへの異なるProjectionとして扱う。

---

# 2. Core Layers

4D Baseは概念上、以下のLayerへ分離する。

## Source Layer

外部・内部データの原典。

## Semantic Layer

データの意味。

## Relation Layer

Hierarchy / Semantic Relation。

## Calculation Layer

計算・Aggregation。

## Lineage Layer

データの由来と流れ。

## Projection Layer

Sheet / Cube。

## Presentation Layer

World / Sheet UI / Cube UI / External Output。

---

# 3. Core Entities

最低限以下の概念Entityを想定する。

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

---

# 4. Box Model

Box

id
type
name
parent_box_id
unit_type
depth
metadata
created_at
updated_at

Boxはデータそのものをコピーしない。

内部オブジェクトとの関係はRelationで保持する。

---

# 5. Card Model

CardはBox属性として扱う。

CardAttribute

id
box_id
attribute_definition_id
value
valid_from
valid_to
source_reference

Cardを独立した表データの代替にしない。

---

# 6. Value Model

Valueは最低限、

id
source
semantic_definition
entity
dimension_members
value
value_type
valid_time
system_time

を追跡可能な設計にする。

実際のDB正規化方式は既存実装を調査して決定する。

---

# 7. Dimension Model

Dimension

id
name
semantic_type
hierarchy_definition

DimensionMember

id
dimension_id
parent_member_id
name
sort_order

例：

Time
 └ 2026
    ├ Q1
    │ ├ Jan
    │ ├ Feb
    │ └ Mar

Organization
 └ 法人
    └ 店舗

---

# 8. Calculation Model

Calculation

id
name
output_semantic
expression
input_references
calculation_type
version

計算結果はSource Valueと区別する。

---

# 9. Aggregation Model

Aggregation

id
function
target_dimension
group_by
filters

SUM / COUNT / AVG / MIN / MAX を初期対象とする。

---

# 10. Relation Model

Relationにはtypeを持たせる。

HIERARCHY
SEMANTIC
REFERENCE

Calculation DependencyとData Lineageは別管理する。

---

# 11. Lineage Model

LineageEdge

source_node
target_node
operation

operation例：

REFERENCE
FILTER
SPLIT
UNION
SUM
CALCULATE
PROJECT

Lineageは最終Sourceまで追跡可能にする。

---

# 12. CubeDefinition

Cubeは値そのものを保存するContainerにしない。

CubeDefinition例：

id
name
sources
axis_configurations
filters
scale
aggregations
view_settings

---

# 13. AxisConfiguration

AxisConfiguration

axis:
X | Y | Z | T

role:
Measure
Entity
Breakdown
Time
Attribute
Status
Hierarchy
Custom

dimension_id
granularity
aggregation
filter
sort

XYZのDimensionは交換可能。

TのTime DimensionもXYZへ移動可能。

---

# 14. SheetDefinition

SheetもデータコピーではなくDefinitionとして保存可能にする。

SheetDefinition

id
name
sources
rows
columns
measures
filters
aggregations
subtotal_rules
grand_total_rules
sort_rules
format_rules

---

# 15. Selection Model

Selection

source_view_id
selected_dimensions
selected_members
selected_time_range
selected_metrics
filters
aggregate_value
selection_geometry

selection_geometry:

POINT
LINE
AREA
VOLUME
MULTI

SelectionはSheet/Cube共通で利用する。

---

# 16. Drill Model

DrillOperation

selection
drill_dimension
target_granularity
target_view

target_view:

SHEET
CUBE
AUTO

Drill後もSelection Rootを保持する。

---

# 17. Drill Context

DrillContext

root_selection
root_value
parent_selection
parent_value
current_selection
current_value
breadcrumb
filters

Drill-up時に再計算ではなくContextから復元可能にする。

---

# 18. ViewState

ViewStateはDataとは分離する。

含めるもの：

axis mapping
camera
zoom
filters
selection
granularity
visible dimensions
time position
sort
expanded hierarchy

---

# 19. Sheet Rendering

Sheet rendererは、

Raw
Reference
Calculated
Subtotal
Grand Total

を識別可能にする。

色のみで表現しない。

---

# 20. Cell Inspector

任意セルから以下を取得するAPI/Serviceを用意する。

getValue()
getSemanticMeaning()
getFormula()
getSource()
getLineage()
getBreakdown()
getAggregation()
getFilters()

---

# 21. Projection Engine

共通Projection Engineを作る。

入力：

Source/Data Graph
Dimension
Filter
Aggregation
Scale
Selection

出力：

Sheet Projection
Cube Projection

SheetとCubeで別々の計算ロジックを実装しない。

---

# 22. Gather

複数Sourceから同じSemantic Definitionを収集できる。

例：

法人A.楽天売上
法人B.楽天売上
法人C.楽天売上

↓

法人 × 楽天 × Month

---

# 23. Split

1つのSourceからDimension条件によって複数Projectionを作成する。

データコピーは禁止。

---

# 24. Cache

大規模データに備えProjection結果のCacheを許可する。

ただしCacheをSource of Truthにしない。

Source更新時にInvalidation可能な構造にする。

---

# 25. Scale Strategy

Cubeで表示可能なデータ量を無制限にしない。

表示前に、

member_count
estimated_points
estimated_edges

を評価する。

閾値超過時は、

- Roll-up
- Filter
- SamplingではなくAggregation
- Granularity変更

を提案する。

業務数値では無断Samplingしない。

---

# 26. History

以下を履歴化する。

Import
Semantic Mapping
Calculation変更
Relation変更
Axis変更
Sheet Definition変更
Cube Definition変更
Drill保存
Publish

データ削除時も履歴を残す。

---

# 27. Security

Box / Sheet / Cube単位だけではなく、
将来的なData Scope権限を考慮する。

外部出力時に内部Lineageや他法人データを漏らさない。

---

# 28. External Sheet Export

Google Sheets等へ出力する場合、

4DB内部のProjection結果から生成する。

Calculated / Total等の書式情報も可能な範囲で反映する。

外部Sheetを内部Source of Truthへ自動昇格させない。

---

# 29. Performance Principle

3Dだから全データを描画する、という設計は禁止。

Server/Data Layerで、

Filter
Group
Aggregate
Projection

を行い、必要な粒度のみClientへ渡す。

---

# 30. Non-negotiable Design Rules

1. UI上のセル位置をデータ意味として保存しない
2. 合計値をDimension Memberとして扱わない
3. Derived ValueをRaw Valueとして保存しない
4. Sheet/Cubeごとにデータを複製しない
5. Lineageを失う変換をしない
6. Drill-downで親Contextを消さない
7. SheetとCubeで別々のデータロジックを作らない
8. XYZの意味を固定しない
9. TをXYZへ移動可能な設計にする
10. 大量データを無条件で3D描画しない
