"use client";

// World(まわりの世界)の選択。P2 は「無地」だけ(ほかの世界は P5 で足す)。選ぶとアカウントに覚える(PrefsProvider)。
// 選べる世界は、芯の WORLDS から出す(増やすときは芯で足せば、ここに並ぶ)
import { WORLD_LABELS, WORLDS } from "@/fourdb/core/prefs";
import { usePrefs } from "../PrefsProvider";
import s from "./settings.module.css";

export function WorldSetting() {
  const { world, setWorld } = usePrefs();
  return (
    <section className="card" aria-labelledby="world-heading">
      <h2 id="world-heading">
        World <span className="muted">まわりの世界</span>
      </h2>
      <div className={s.choices} role="radiogroup" aria-labelledby="world-heading">
        {WORLDS.map((w) => (
          <label key={w} className={s.choice}>
            <input type="radio" name="world" value={w} checked={world === w} onChange={() => setWorld(w)} />
            <span>{WORLD_LABELS[w]}</span>
          </label>
        ))}
      </div>
      <p className="muted">ほかの世界は、あとで選べるようになります。</p>
    </section>
  );
}
