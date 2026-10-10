"use client";

// 画面の見た目の切り替え。選ぶと、いまの画面がすぐ変わり(再読み込みなし)、クッキー(fourdb_theme)に写し、アカウントに覚える(PrefsProvider)。
// 次に開いたときは、サーバーがクッキーを読んで最初の HTML に data-theme を出す(src/app/layout.tsx)。別のパソコンでは、読み込みのとき
// アカウントの値に合わせる。「パソコンの設定に合わせる」は、クッキーと印を消す(CSS が OS の明暗に合わせる)
import { THEME_LABELS, type Theme } from "@/fourdb/core/prefs";
import { usePrefs } from "../PrefsProvider";
import s from "./settings.module.css";

type Choice = Theme | "auto";

const CHOICES: { value: Choice; label: string }[] = [
  { value: "dark", label: THEME_LABELS.dark },
  { value: "light", label: THEME_LABELS.light },
  { value: "auto", label: "パソコンの設定に合わせる" },
];

export function ThemeSetting() {
  const { theme, setTheme, saveState } = usePrefs();
  const choice: Choice = theme ?? "auto";

  return (
    <section className="card" aria-labelledby="theme-heading">
      <h2 id="theme-heading">画面の見た目</h2>
      <div className={s.choices} role="radiogroup" aria-labelledby="theme-heading">
        {CHOICES.map((c) => (
          <label key={c.value} className={s.choice}>
            <input type="radio" name="theme" value={c.value} checked={choice === c.value} onChange={() => setTheme(c.value === "auto" ? null : c.value)} />
            <Swatch value={c.value} />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
      <p className="muted">選んだものは、アカウントに覚えます(どのパソコンでも同じになります)。</p>
      {saveState === "error" && <p className="error" role="alert">アカウントに保存できませんでした。このブラウザには覚えています。</p>}
      {saveState === "local" && <p className="muted">いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)</p>}
    </section>
  );
}

/** 見た目の小さな見本。data-theme を付けた入れ物の中では、その見た目の色になる(「合わせる」は半分ずつ) */
function Swatch({ value }: { value: Choice }) {
  const halves: Theme[] = value === "auto" ? ["light", "dark"] : [value];
  return (
    <span className={s.swatch} aria-hidden="true">
      {halves.map((t) => (
        <span key={t} className={s.half} data-theme={t}>
          <i className={s.bar} />
          <i className={s.dot} />
        </span>
      ))}
    </span>
  );
}
