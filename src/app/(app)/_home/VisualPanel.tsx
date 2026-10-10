// Visual(見た目の欄)。舞台の右下の「Visual」ボタンで開く。パターン(6 つの部品をまとめて)と、部品を 1 つずつ変えるボタン、明暗(2 択)。
// 選んだらすぐ立体に写し(HomeStage が stage.setLook)、アカウントへ覚える(usePrefs の setLook・setTheme。送り方は prefs-sync.ts)。
// 読み込んだときは閉じている。右の欄(Box)と同時に開ける(立体は両方をよける)。開いたら最初の操作へフォーカス、Escape と「閉じる」でボタンへ戻す。
import { useEffect, useRef, useSyncExternalStore, type Ref } from "react";
import {
  LOOK_KEY_LABELS,
  LOOK_KEYS,
  LOOK_OPTIONS,
  LOOK_VALUE_LABELS,
  PATTERN_LABELS,
  PATTERNS,
  patternOf,
  THEME_LABELS,
  type Look,
  type LookKey,
  type Theme,
} from "@/fourdb/core/prefs";
import type { SaveState } from "../prefs-sync";
import s from "./home3d.module.css";
import {
  CLOSE_LABEL,
  currentPatternText,
  PATTERN_GROUP_LABEL,
  RETRY_LABEL,
  saveMessage,
  THEME_GROUP_LABEL,
  VISUAL_BUTTON_NOTE,
  VISUAL_SUB,
  VISUAL_TITLE,
} from "./view";

export const VISUAL_PANEL_ID = "visual-panel";

/** 明暗の 2 択の並び */
const THEME_ORDER: readonly Theme[] = ["light", "dark"];

// 明暗が「パソコンの設定に合わせる」(null)のときに、いま出ている明暗を選んだ形で見せるため、パソコンの設定を読む
const DARK_MQ = "(prefers-color-scheme: dark)";
const subscribeScheme = (fn: () => void) => {
  const mq = window.matchMedia(DARK_MQ);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
};
const osIsDark = () => window.matchMedia(DARK_MQ).matches;

export type VisualPanelProps = {
  open: boolean;
  /** 「Visual」ボタン(開く・閉じる) */
  onToggle: () => void;
  /** 「閉じる」(ボタンへフォーカスを戻す) */
  onClose: () => void;
  look: Look;
  onLook: (next: Look) => void;
  /** 選んでいる明暗(null = パソコンの設定に合わせる) */
  theme: Theme | null;
  onTheme: (next: Theme) => void;
  saveState: SaveState;
  onRetry: () => void;
  /** 札を指定と違う置き方にしたときの説明(なければ空) */
  labelNote: string;
  /** 欄とボタンを包む入れ物(立体がよける四角) */
  wrapRef?: Ref<HTMLDivElement>;
  buttonRef?: Ref<HTMLButtonElement>;
};

export function VisualPanel({ open, onToggle, onClose, look, onLook, theme, onTheme, saveState, onRetry, labelNote, wrapRef, buttonRef }: VisualPanelProps) {
  const dark = useSyncExternalStore(subscribeScheme, osIsDark, () => false);
  const effectiveTheme: Theme = theme ?? (dark ? "dark" : "light");
  const current = patternOf(look);
  const firstRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  const message = saveMessage(saveState);

  // 開いたら最初の操作(パターン 1)へ
  useEffect(() => {
    if (open && !wasOpen.current) firstRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const part = <K extends LookKey>(key: K, value: Look[K]) => onLook({ ...look, [key]: value });

  return (
    <div className={s.visual} ref={wrapRef} data-open={open}>
      <section id={VISUAL_PANEL_ID} className={s.vpanel} aria-labelledby={`${VISUAL_PANEL_ID}-h`} hidden={!open}>
        <div className={s.vhead}>
          <h2 id={`${VISUAL_PANEL_ID}-h`}>
            {VISUAL_TITLE}
            <small>{VISUAL_SUB}</small>
          </h2>
          <span className={s.tcur}>{currentPatternText(look)}</span>
          <button type="button" className={s.vclose} aria-label={CLOSE_LABEL} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className={s.tbody}>
          <div className={s.tpre} role="group" aria-label={PATTERN_GROUP_LABEL}>
            {PATTERNS.map((pt, i) => (
              <button
                key={pt.id}
                ref={i === 0 ? firstRef : undefined}
                type="button"
                className={s.pre}
                aria-pressed={current?.id === pt.id}
                title={PATTERN_LABELS[pt.id].mood}
                onClick={() => onLook({ ...pt.look })}
              >
                <span className={s.pn}>{pt.id}</span>
                {PATTERN_LABELS[pt.id].name}
              </button>
            ))}
          </div>
          {LOOK_KEYS.map((key) => (
            <div key={key} className={s.seg} role="group" aria-labelledby={`vis-${key}`}>
              <span className={s.sl} id={`vis-${key}`}>
                {LOOK_KEY_LABELS[key]}
              </span>
              <div className={s.opts}>
                {(LOOK_OPTIONS[key] as readonly Look[typeof key][]).map((v) => (
                  <button key={v} type="button" aria-pressed={look[key] === v} onClick={() => part(key, v)}>
                    {(LOOK_VALUE_LABELS[key] as Record<string, string>)[v]}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className={s.seg} role="group" aria-labelledby="vis-theme">
            <span className={s.sl} id="vis-theme">
              {THEME_GROUP_LABEL}
            </span>
            <div className={s.opts}>
              {THEME_ORDER.map((t) => (
                <button key={t} type="button" aria-pressed={effectiveTheme === t} onClick={() => onTheme(t)}>
                  {THEME_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <p className={s.tnote} role="status">
            {labelNote}
          </p>
          <div className={s.vsave}>
            <span role="status" className={saveState === "error" ? s.vsaveError : undefined}>
              {message}
            </span>
            {saveState === "error" && (
              <button type="button" className="small" onClick={onRetry}>
                {RETRY_LABEL}
              </button>
            )}
          </div>
        </div>
      </section>
      <button
        type="button"
        ref={buttonRef}
        className={s.vbtn}
        aria-expanded={open}
        aria-controls={VISUAL_PANEL_ID}
        onClick={onToggle}
      >
        <span className={s.tt}>{VISUAL_TITLE}</span>
        <span className={s.tsub}>{VISUAL_BUTTON_NOTE}</span>
        <span className={s.chev} aria-hidden="true">
          ▴
        </span>
      </button>
    </div>
  );
}
