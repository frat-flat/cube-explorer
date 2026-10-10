// 3D を作れなかったとき(WebGL がない・読み込みに失敗・作れない・文脈を失った)の、平らなタイル。
// 単位ごとに、右の欄と同じ欄を全部出す。ほかの単位の行は、タイルの下に出す。
import { unitLabel, type HomeUnit, type Listed, type UnitRef } from "@/fourdb/core/home";
import s from "./home3d.module.css";
import { OthersText, Sections } from "./Sections";
import { fmt, FLAT_NOTE } from "./view";

export function FlatTiles({ units, others }: { units: HomeUnit[]; others: Listed<UnitRef> }) {
  return (
    <div className={s.flat}>
      <p className={s.fnote}>{FLAT_NOTE}</p>
      <div className={s.btiles}>
        {units.map((u, i) => (
          <article key={u.key} className={s.btile} aria-labelledby={`flat-${i}-h flat-${i}-n`}>
            <div className={s.bhead}>
              <h3 id={`flat-${i}-h`} className={u.unitType === null ? s.unitNone : undefined}>
                {unitLabel(u.unitType)}
              </h3>
              <span id={`flat-${i}-n`} className={s.big}>
                <span className={s.n}>{fmt(u.count)}</span>
              </span>
            </div>
            <Sections unit={u} />
          </article>
        ))}
      </div>
      {others.items.length > 0 && (
        <p className={`${s.fnote} ${s.fothers}`}>
          <OthersText others={others} />
        </p>
      )}
    </div>
  );
}
