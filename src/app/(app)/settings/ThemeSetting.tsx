"use client";

// 画面の見た目の切り替え。選ぶとクッキー(fourdb_theme)に覚え、いまの画面もすぐ変える(再読み込みなし)。
// 次に開いたときは、サーバーがクッキーを読んで最初の HTML に data-theme を出す(src/app/layout.tsx)。
// 「パソコンの設定に合わせる」は、クッキーと印を消す(CSS が OS の明暗に合わせる)
import { useState } from "react";
import { THEME_COOKIE, writeCookie, type Theme } from "@/lib/prefs";
import s from "./settings.module.css";

type Choice = Theme | "auto";

const CHOICES: { value: Choice; label: string }[] = [
  { value: "dark", label: "暗い" },
  { value: "light", label: "明るい" },
  { value: "auto", label: "パソコンの設定に合わせる" },
];

export function ThemeSetting({ initial }: { initial: Choice }) {
  const [choice, setChoice] = useState<Choice>(initial);

  function choose(next: Choice) {
    setChoice(next);
    const root = document.documentElement;
    if (next === "auto") {
      writeCookie(THEME_COOKIE, null);
      root.removeAttribute("data-theme");
    } else {
      writeCookie(THEME_COOKIE, next);
      root.setAttribute("data-theme", next);
    }
  }

  return (
    <section className="card" aria-labelledby="theme-heading">
      <h2 id="theme-heading">画面の見た目</h2>
      <div className={s.choices} role="radiogroup" aria-labelledby="theme-heading">
        {CHOICES.map((c) => (
          <label key={c.value} className={s.choice}>
            <input type="radio" name="theme" value={c.value} checked={choice === c.value} onChange={() => choose(c.value)} />
            <Swatch value={c.value} />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
      <p className="muted">選んだものは、このブラウザに覚えます。</p>
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
