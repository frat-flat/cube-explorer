import { sql } from "@/lib/db";
import { toAxis, type Axis, type AxisRow } from "./axes";
import { toFact, type Fact, type FactRow } from "./facts";

export type Meta = { axes: Map<string, Axis>; facts: Map<string, Fact> };

export async function loadAxes(): Promise<Axis[]> {
  const rows = await sql<AxisRow[]>`
    select key, label, kind, source_table, source_column, label_column, key_column, time_grain, master_key
    from cube_meta.axes
    order by key
  `;
  return rows.map(toAxis);
}

export async function loadFacts(): Promise<Fact[]> {
  const rows = await sql<FactRow[]>`
    select key, label, source_table, axis_columns, measures
    from cube_meta.facts
    order by key
  `;
  return rows.map(toFact);
}

export async function loadMeta(): Promise<Meta> {
  const [axes, facts] = await Promise.all([loadAxes(), loadFacts()]);
  return {
    axes: new Map(axes.map((a) => [a.key, a])),
    facts: new Map(facts.map((f) => [f.key, f])),
  };
}
