// 単位の欄(右の欄と、3D を作れなかったときの平らなタイルで同じもの)。並びはどの利用者でも同じで、値がない欄は「—」(D-017)。
// 並びと中身は芯の sectionsOf、見出しは芯の SECTION_LABELS。利用者の文字は React の文字として出す(innerHTML は使わない)。
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import {
  CALCULATED_LABEL,
  CALCULATED_MARK,
  NO_VALUE_MARK,
  PHASE_MARKS,
  SECTION_LABELS,
  sectionsOf,
  unitLabel,
  type HomeUnit,
  type Listed,
  type Section,
  type UnitRef,
} from "@/fourdb/core/home";
import { formatDateTokyo } from "../format";
import s from "./home3d.module.css";
import { fmt, LAST_READ_PREFIX, MORE_PREFIX, OTHERS_PREFIX, splitNumbers, tableHref } from "./view";

/** 文字の中の数字を Montserrat で出す */
export function Txt({ text }: { text: string }) {
  return (
    <>
      {splitNumbers(text).map((p, i) =>
        p.n ? (
          <span key={i} className={s.n}>
            {p.text}
          </span>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

/** 値がない */
const None = () => <span className={s.none}>{NO_VALUE_MARK}</span>;

/** 「・」で区切った並びと、見せきれなかった数(ほか N) */
function List<T>({ list, item, wrap = false }: { list: Listed<T>; item: (x: T) => ReactNode; wrap?: boolean }) {
  return (
    <>
      {list.items.map((x, i) => (
        <Fragment key={i}>
          {i > 0 && "・"}
          <span className={wrap ? undefined : s.nm}>{item(x)}</span>
        </Fragment>
      ))}
      {list.more > 0 && (
        <>
          {" "}
          <span className={s.more}>
            {MORE_PREFIX} <span className={s.n}>{fmt(list.more)}</span>
          </span>
        </>
      )}
    </>
  );
}

function value(sec: Section): ReactNode {
  switch (sec.id) {
    case "names":
    case "cardFields":
      return sec.value ? <List list={sec.value} item={(t) => <Txt text={t} />} /> : <None />;
    case "inside":
      return sec.value ? (
        <List
          list={sec.value}
          item={(u) => (
            <>
              <Txt text={unitLabel(u.unitType)} /> <span className={s.n}>{fmt(u.count)}</span>
            </>
          )}
        />
      ) : (
        <None />
      );
    case "measures":
      return sec.value ? (
        <List
          list={sec.value}
          item={(m) => (
            <>
              <Txt text={m.name} />
              {m.calculated && (
                <span className="mark" role="img" aria-label={CALCULATED_LABEL}>
                  {CALCULATED_MARK}
                </span>
              )}
            </>
          )}
        />
      ) : (
        <None />
      );
    case "period":
      return sec.value ? (
        <>
          <span className={s.n}>{sec.value.from}</span>〜<span className={s.n}>{sec.value.to}</span>
        </>
      ) : (
        <None />
      );
    case "sheets": {
      if (!sec.value) return <None />;
      const last = sec.value.lastReadAt ? formatDateTokyo(sec.value.lastReadAt) : "";
      return (
        <>
          <List
            list={sec.value}
            wrap
            item={(x) => (
              <>
                <Txt text={x.file} /> › <Txt text={x.sheet} />
              </>
            )}
          />
          <span className={s.sub}>
            {LAST_READ_PREFIX} {last ? <span className={s.n}>{last}</span> : NO_VALUE_MARK}
          </span>
        </>
      );
    }
    case "tables":
      return sec.value ? (
        <List
          list={sec.value}
          item={(t) => (
            <Link href={tableHref(t.id)}>
              <Txt text={t.name} /> ›
            </Link>
          )}
        />
      ) : (
        <None />
      );
    case "cube":
    case "bands":
      return <span className={s.phase}>{PHASE_MARKS[sec.phase]}</span>;
  }
}

/** 「ほかの単位: 部署 12・担当者 5 ほか N」(7 つ目からの単位。立体の舞台と平らなタイルで同じ文) */
export function OthersText({ others }: { others: Listed<UnitRef> }) {
  return (
    <>
      {OTHERS_PREFIX}
      <List
        list={others}
        item={(u) => (
          <>
            <b className={u.unitType === null ? s.unitNone : undefined}>{unitLabel(u.unitType)}</b> <span className={s.n}>{fmt(u.count)}</span>
          </>
        )}
      />
    </>
  );
}

/** 欄を固定の順で全部(値がない欄も省かない) */
export function Sections({ unit }: { unit: HomeUnit }) {
  return (
    <dl className={s.secs}>
      {sectionsOf(unit).map((sec) => (
        <div key={sec.id} className={sec.id === "cube" || sec.id === "bands" ? `${s.sec} ${s.fut}` : s.sec} data-section={sec.id}>
          <dt className={s.lbl}>{SECTION_LABELS[sec.id]}</dt>
          <dd className={s.val}>{value(sec)}</dd>
        </div>
      ))}
    </dl>
  );
}
