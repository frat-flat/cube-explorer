// 右の欄(Box の中身)。札か立体を押すと開く。モーダルにはしない(立体も札も触れるまま)。閉じている間は inert。
// 開いたら見出し(単位の名前と数。tabIndex=-1)へフォーカスを移す(HomeStage が行う)。閉じる動きの間も、前の単位の中身を出しておく。
import type { Ref } from "react";
import { PHASE_MARKS, unitLabel, type HomeUnit } from "@/fourdb/core/home";
import s from "./home3d.module.css";
import { Sections } from "./Sections";
import { CLOSE_LABEL, fmt, PHASE_NOTE } from "./view";

export const BOX_PANEL_ID = "box-panel";

export function BoxPanel({ unit, open, onClose, panelRef, headingRef }: { unit: HomeUnit | null; open: boolean; onClose: () => void; panelRef?: Ref<HTMLElement>; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <aside id={BOX_PANEL_ID} ref={panelRef} className={open ? `${s.bpanel} ${s.open}` : s.bpanel} aria-labelledby={`${BOX_PANEL_ID}-h`} inert={!open}>
      <div className={s.bphead}>
        <span className={s.kicker}>Box</span>
        <h2 id={`${BOX_PANEL_ID}-h`} ref={headingRef} tabIndex={-1}>
          <span className={unit && unit.unitType === null ? `${s.bpname} ${s.unitNone}` : s.bpname}>{unit ? unitLabel(unit.unitType) : ""}</span>{" "}
          <span className={s.big}>
            <span className={s.n}>{unit ? fmt(unit.count) : ""}</span>
          </span>
        </h2>
        <button type="button" className={s.close} aria-label={CLOSE_LABEL} onClick={onClose}>
          ✕
        </button>
      </div>
      {/* 単位が変わったら中身を作り直す(縦のスクロールを先頭に戻す) */}
      <div className={s.bpbody} key={unit?.key ?? ""}>
        {unit && <Sections unit={unit} />}
        <p className={s.stagekey}>
          <span className={s.phase}>{PHASE_MARKS.P8}</span>
          <span className={s.phase}>{PHASE_MARKS.P11}</span>
          {PHASE_NOTE}
        </p>
      </div>
    </aside>
  );
}
