"use client";

// アカウントに覚える設定(明暗・World・立体の見た目)を、画面のどこからでも読み書きできるようにする。
// 枠(layout.tsx)が包む。layout はクッキーだけを読み(DB は読まない)、最初の明暗(initialTheme)と、DB があるか(enabled)を渡す。
// DB がなければ(enabled = false)通信しない。あれば、タブの読み込みごとに 1 回だけ GET して、クッキーとアカウントを突き合わせる。
// 覚え方と送り方の決まりは prefs-sync.ts(React に依存しない。試験もそこ)。
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Look, Theme, WorldId } from "@/fourdb/core/prefs";
import { browserDeps, cookieOnlyDeps, readCookieTheme } from "./prefs-client";
import { PrefsStore, type SaveState } from "./prefs-sync";

export type { SaveState } from "./prefs-sync";

/**
 * usePrefs() が返すもの。形は変えない(ホームの Visual の欄と設定の画面が使う)。
 * - look / setLook: 立体の見た目(6 つの部品をそろえて渡す)。800ms まとめてアカウントへ送る
 * - theme / setTheme: 明暗(null =「パソコンの設定に合わせる」)。すぐクッキーと <html data-theme> に反映し、すぐ送る
 * - world / setWorld: World(まわりの世界)。すぐ送る
 * - available: アカウントへ保存できるか(false なら、このパソコンにだけ覚える)
 * - saveState: idle / saving / saved / error / local(local = available が false のとき)
 * - retry: 送れなかった分を送り直す
 * - loaded: タブの読み込みごとの最初の突き合わせが終わったか。終わるまでの look・world は、アカウントの値とは限らない
 *   (立体は、これが true になってから作ると、既定の見た目から切り替わるちらつきがない)
 */
export type PrefsApi = {
  look: Look;
  setLook: (next: Look) => void;
  theme: Theme | null;
  setTheme: (next: Theme | null) => void;
  world: WorldId;
  setWorld: (next: WorldId) => void;
  available: boolean;
  saveState: SaveState;
  retry: () => void;
  loaded: boolean;
};

/** 試験が、決まった状態の入れ物を渡すために export している(画面からは PrefsProvider を使う) */
export const PrefsContext = createContext<PrefsStore | null>(null);

export function PrefsProvider({ initialTheme, enabled, children }: { initialTheme: Theme | null; enabled: boolean; children: ReactNode }) {
  const [store] = useState(() => new PrefsStore(browserDeps(), { enabled, initialTheme }));
  useEffect(() => {
    const stop = store.start();
    // 隠れたとき・ページを離れるときは、送っていない分を keepalive で送る(閉じても要求が切れない)
    const onHide = () => {
      if (document.visibilityState === "hidden") store.flush(true);
    };
    const onLeave = () => store.flush(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeave);
      stop();
    };
  }, [store]);
  return <PrefsContext.Provider value={store}>{children}</PrefsContext.Provider>;
}

/** Provider の外(設定の画面だけを単独で描く試験など)で使うときの入れ物。アカウントへは何も送らず、クッキーと <html data-theme> だけを変える */
let fallback: PrefsStore | null = null;
function fallbackStore(): PrefsStore {
  fallback ??= new PrefsStore(cookieOnlyDeps(), { enabled: false, initialTheme: typeof document === "undefined" ? null : readCookieTheme() });
  return fallback;
}

export function usePrefs(): PrefsApi {
  const store = useContext(PrefsContext) ?? fallbackStore();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return useMemo(
    () => ({ ...snap, setTheme: store.setTheme, setLook: store.setLook, setWorld: store.setWorld, retry: store.retry }),
    [snap, store],
  );
}
