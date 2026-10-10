"use client";

// ホーム(/): いちばん上の Box を単位ごとに 1 つの立体にして、World の舞台に並べる(D-017)。中身は GET /api/4db/home を 1 回読む。
// 立体(three)は src/fourdb/ui/home3d を、ここの useEffect で import() して作る(three はホームでしか読まない)。
// 作るのは、アカウントの見た目を読み終えてから(loaded。既定の見た目から切り替わるちらつきをなくす)。
// WebGL がない・読み込みに失敗した・作れなかった・文脈を失ったときは、平らなタイル(FlatTiles)。
//
// 文字(札・右の欄・ほかの単位・平らなタイル・Visual の欄)は React が描く。立体のモジュールが触るのは、自分の <canvas>・backdrop の SVG・
// 札の入れ物(li)の style.transform と --k・others の style.top・root の data-label / data-motion / data-ready(と data-mode = 3d)だけ。
// React はそこへ style を書かない(札の li・others には style を渡さない。key は単位の目印で固定)。
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { HOME_LIMITS, unitLabel, type HomeOverview } from "@/fourdb/core/home";
import type { Look, Theme } from "@/fourdb/core/prefs";
import type { LabelModeReason, Stage, StageCallbacks } from "@/fourdb/ui/home3d/types";
import { api } from "../api";
import { usePrefs } from "../PrefsProvider";
import { BOX_PANEL_ID, BoxPanel } from "./BoxPanel";
import { FlatTiles } from "./FlatTiles";
import s from "./home3d.module.css";
import { OthersText } from "./Sections";
import { EMPTY_ACTION, EMPTY_TEXT, EMPTY_TITLE, fmt, labelNoteText, LABELS_ARIA, STAGE_SUB, STAGE_TITLE } from "./view";
import { VisualPanel } from "./VisualPanel";

/** root の data-mode(試験の印)。loading = 読み込み中・立体を作る前 / 3d / flat = 平らなタイル / empty = Box がない / error = 読めなかった */
type Mode = "loading" | "3d" | "flat" | "empty" | "error";

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/** 立体がよける四角。transform(開く動き)の途中でも、置き終わった所の四角を返す(offsetLeft・offsetTop は transform を含まない) */
function settledRect(root: HTMLElement, el: HTMLElement, shiftX = 0): DOMRect {
  const r = root.getBoundingClientRect();
  return new DOMRect(r.left + el.offsetLeft + shiftX, r.top + el.offsetTop, el.offsetWidth, el.offsetHeight);
}

export function HomeStage() {
  const prefs = usePrefs();
  const [data, setData] = useState<HomeOverview | null>(null);
  const [error, setError] = useState("");
  const [threeState, setThreeState] = useState<"pending" | "3d" | "flat">("pending");
  // 右の欄: index = 中身を出している単位(閉じる動きの間も前の中身を出す)、open = 開いているか
  const [panel, setPanel] = useState({ index: -1, open: false });
  const [visualOpen, setVisualOpen] = useState(false);
  const [labelHot, setLabelHot] = useState(-1);
  const [canvasHot, setCanvasHot] = useState(-1);
  const [labelReason, setLabelReason] = useState<LabelModeReason>("");

  const rootRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const othersRef = useRef<HTMLParagraphElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const visualBtnRef = useRef<HTMLButtonElement>(null);
  const labelRefs = useRef<(HTMLLIElement | null)[]>([]);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const stageRef = useRef<Stage | null>(null);
  // 立体のモジュールから呼ばれる関数(mount のときに渡す)が、いまの状態を読むための写し
  const openRef = useRef(-1);
  const visualOpenRef = useRef(false);
  const lookRef = useRef<Look>(prefs.look);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const focusHeading = useRef(false);

  const units = data ? data.units.slice(0, HOME_LIMITS.units) : [];
  const n = units.length;
  const open = panel.open ? panel.index : -1;
  const mode: Mode = error ? "error" : !data ? "loading" : n === 0 ? "empty" : threeState === "pending" ? "loading" : threeState;
  const flat = threeState === "flat";

  // 開いたときに 1 回、外(サーバー)から読む
  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const o = await api<HomeOverview>("/api/4db/home", { signal: ctrl.signal });
        if (!ctrl.signal.aborted) setData(o);
      } catch (e) {
        if (!ctrl.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => ctrl.abort();
  }, []);

  // ---- 右の欄 ----
  const openPanel = useCallback((i: number) => {
    openerRef.current = buttonRefs.current[i] ?? null;
    focusHeading.current = true;
    setPanel({ index: i, open: true });
  }, []);
  const closePanel = useCallback(() => {
    setPanel((p) => ({ ...p, open: false }));
    const opener = openerRef.current;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }, []);
  const togglePanel = useCallback((i: number) => (openRef.current === i ? closePanel() : openPanel(i)), [openPanel, closePanel]);

  useEffect(() => {
    openRef.current = open;
    stageRef.current?.setSelected(open);
    if (open >= 0 && focusHeading.current) {
      focusHeading.current = false;
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // ---- Visual の欄 ----
  const closeVisual = useCallback(() => {
    setVisualOpen(false);
    visualBtnRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    visualOpenRef.current = visualOpen;
    stageRef.current?.reframe();
  }, [visualOpen]);

  // Escape: Visual の欄 → 右の欄 の順に閉じる(モーダルではないので、どこにフォーカスがあっても)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (visualOpenRef.current) {
        e.preventDefault();
        closeVisual();
      } else if (openRef.current >= 0) {
        e.preventDefault();
        closePanel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeVisual, closePanel]);

  // ---- 見た目: 立体へすぐ写す(アカウントへは usePrefs が送る) ----
  useEffect(() => {
    lookRef.current = prefs.look;
    stageRef.current?.setLook(prefs.look);
  }, [prefs.look]);
  const changeLook = (next: Look) => {
    stageRef.current?.setLook(next);
    prefs.setLook(next);
  };
  const changeTheme = (next: Theme) => prefs.setTheme(next);

  // ---- 立体を作る(データとアカウントの見た目がそろってから。作れなければ平らなタイル) ----
  const { loaded, world } = prefs;
  useEffect(() => {
    if (!data || !loaded || n === 0) return;
    let cancelled = false;
    let stage: Stage | null = null;
    const toFlat = () => {
      if (cancelled) return;
      stage?.dispose();
      if (stageRef.current === stage) stageRef.current = null;
      setThreeState("flat");
    };
    const callbacks: StageCallbacks = {
      onPick: (i) => togglePanel(i),
      onHover: (i) => setCanvasHot(i),
      onLabelMode: (_mode, reason) => setLabelReason(reason),
      onLost: toFlat,
      occluders: () => {
        const root = rootRef.current;
        if (!root) return [];
        const out: DOMRect[] = [];
        const panelEl = panelRef.current;
        if (openRef.current >= 0 && panelEl) out.push(settledRect(root, panelEl));
        // Visual の欄は、右の欄が開いている間、その幅だけ左へ寄る(CSS の transform)
        if (visualOpenRef.current && visualRef.current) out.push(settledRect(root, visualRef.current, openRef.current >= 0 && panelEl ? -panelEl.offsetWidth : 0));
        return out;
      },
    };
    void (async () => {
      let mod: typeof import("@/fourdb/ui/home3d");
      try {
        mod = await import("@/fourdb/ui/home3d");
      } catch {
        toFlat();
        return;
      }
      if (cancelled) return;
      const root = rootRef.current;
      const canvasHost = hostRef.current;
      const backdrop = backdropRef.current;
      const labels = labelRefs.current.slice(0, n);
      if (!mod.canUseWebGL() || !root || !canvasHost || !backdrop || labels.length !== n || labels.some((x) => !x)) {
        toFlat();
        return;
      }
      try {
        stage = mod.mountStage({ root, canvasHost, backdrop, labels: labels as HTMLElement[], others: othersRef.current }, n, lookRef.current, world, callbacks);
      } catch {
        toFlat();
        return;
      }
      stageRef.current = stage;
      stage.setSelected(openRef.current);
      setThreeState("3d");
    })();
    return () => {
      cancelled = true;
      stage?.dispose();
      if (stageRef.current === stage) stageRef.current = null;
    };
  }, [data, loaded, world, n, togglePanel]);

  const shownUnit = panel.index >= 0 ? (units[panel.index] ?? null) : null;
  const others = data?.others ?? { items: [], more: 0 };
  const look = prefs.look;

  return (
    <div className={s.home}>
      <h1 className={s.vh}>ホーム</h1>
      <section
        ref={rootRef}
        className={cx(s.stage3d, n > 3 && s.many, open >= 0 && !flat && s.panelOpen)}
        aria-labelledby="stage-h"
        data-mode={mode}
        data-bg={look.bg}
        data-base={look.base}
        data-layout={look.layout}
      >
        {!flat && (
          <>
            <div ref={backdropRef} className={s.backdrop} aria-hidden="true" />
            <div ref={hostRef} className={s.canvasHost} />
          </>
        )}
        <div className={s.cap}>
          <h2 id="stage-h">
            {STAGE_TITLE}
            <span className={s.capSub}>{STAGE_SUB}</span>
          </h2>
        </div>

        {mode === "loading" && !data && (
          <p className={cx(s.status, s.loadingText)} aria-live="polite">
            <span className="spin" aria-hidden="true" />
            読み込んでいます…
          </p>
        )}
        {error && (
          <p className={cx("error", s.status)} role="alert">
            {error}
          </p>
        )}
        {mode === "empty" && (
          <div className={s.empty}>
            <section className="card" aria-labelledby="empty-h">
              <h2 id="empty-h">{EMPTY_TITLE}</h2>
              <p>{EMPTY_TEXT}</p>
              <p>
                <Link className="primary" href="/migrate">
                  {EMPTY_ACTION}
                </Link>
              </p>
            </section>
          </div>
        )}

        {n > 0 && !flat && (
          <>
            <ul className={s.ulabels} aria-label={LABELS_ARIA}>
              {units.map((u, i) => (
                <li
                  key={u.key}
                  ref={(el) => {
                    labelRefs.current[i] = el;
                  }}
                >
                  <button
                    type="button"
                    ref={(el) => {
                      buttonRefs.current[i] = el;
                    }}
                    className={cx(s.ulabel, (labelHot === i || canvasHot === i) && s.hot)}
                    aria-expanded={open === i}
                    aria-controls={BOX_PANEL_ID}
                    onClick={() => togglePanel(i)}
                    onPointerEnter={() => {
                      setLabelHot(i);
                      stageRef.current?.setHot(i);
                    }}
                    onPointerLeave={() => {
                      setLabelHot(-1);
                      stageRef.current?.setHot(-1);
                    }}
                    onFocus={() => {
                      setLabelHot(i);
                      stageRef.current?.setHot(i);
                      stageRef.current?.setView(i);
                    }}
                    onBlur={() => {
                      setLabelHot(-1);
                      stageRef.current?.setHot(-1);
                      stageRef.current?.setView(-1);
                    }}
                  >
                    <span className={cx(s.un, u.unitType === null && s.unitNone)}>{unitLabel(u.unitType)}</span>{" "}
                    <span className={s.uc}>
                      <span className={s.n}>{fmt(u.count)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {others.items.length > 0 && (
              <p ref={othersRef} className={s.others}>
                <OthersText others={others} />
              </p>
            )}
            <BoxPanel unit={shownUnit} open={open >= 0} onClose={closePanel} panelRef={panelRef} headingRef={headingRef} />
            <VisualPanel
              open={visualOpen}
              onToggle={() => setVisualOpen((v) => !v)}
              onClose={closeVisual}
              look={look}
              onLook={changeLook}
              theme={prefs.theme}
              onTheme={changeTheme}
              saveState={prefs.saveState}
              onRetry={prefs.retry}
              labelNote={labelNoteText(labelReason, look.base)}
              wrapRef={visualRef}
              buttonRef={visualBtnRef}
            />
          </>
        )}

        {n > 0 && flat && <FlatTiles units={units} others={others} />}
      </section>
    </div>
  );
}
