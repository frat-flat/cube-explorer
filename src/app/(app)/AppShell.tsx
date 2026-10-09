"use client";

// 枠のうち、操作や「いまの場所」に合わせて変わる部分(クライアント部品)。枠そのもの(上の帯・メール・ログアウト)は layout.tsx(サーバー)
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Fragment, useContext, useState, type ReactNode } from "react";
import { NAV_COOKIE, writeCookie } from "@/lib/prefs";
import { isCurrent, LEGACY, placeOf, SCREENS, type Screen } from "./screens";

const NavContext = createContext<{ closed: boolean; toggle: () => void } | null>(null);

/** 枠の外側。左のメニューを閉じているかを持つ。最初の状態はサーバーがクッキーから決める(ちらつかない)。はじめは閉じていて、開いたらクッキーに覚える */
export function ShellFrame({ initialClosed, children }: { initialClosed: boolean; children: ReactNode }) {
  const [closed, setClosed] = useState(initialClosed);
  const toggle = () => {
    setClosed(!closed);
    writeCookie(NAV_COOKIE, closed ? "open" : null);
  };
  return (
    <NavContext.Provider value={{ closed, toggle }}>
      <div className="shell" data-nav={closed ? "closed" : "open"}>{children}</div>
    </NavContext.Provider>
  );
}

/** ☰ のボタン。メニューを閉じる・開く */
export function NavToggle() {
  const nav = useContext(NavContext);
  if (!nav) return null;
  return (
    <button type="button" className="navbtn" onClick={nav.toggle} aria-expanded={!nav.closed} aria-controls="app-nav" aria-label={nav.closed ? "メニューを開く" : "メニューを閉じる"}>
      ☰
    </button>
  );
}

/** 今いる場所(例「見る › Table」) */
export function Crumb() {
  const place = placeOf(usePathname());
  return place ? <span className="crumb">{place}</span> : null;
}

function NavLink({ screen, pathname, sub }: { screen: Screen; pathname: string; sub?: boolean }) {
  return (
    <Link href={screen.href} className={sub ? "nv sub" : "nv top-gap"} aria-current={isCurrent(pathname, screen.href) ? "page" : undefined}>
      <span className="ic" aria-hidden="true">{screen.icon}</span>
      <span className="lb">
        {screen.label}
        {screen.note && <small>{screen.note}</small>}
      </span>
    </Link>
  );
}

/** 左のメニュー。今いる画面に aria-current="page"(見た目の印もこれで付く) */
export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="side" id="app-nav" aria-label="画面">
      {SCREENS.map((s, i) => (
        <Fragment key={s.href}>
          {s.group && s.group !== SCREENS[i - 1]?.group && <span className="ngh">{s.group}</span>}
          <NavLink screen={s} pathname={pathname} sub={Boolean(s.group)} />
        </Fragment>
      ))}
      <div className="hair" aria-hidden="true" />
      {/* 旧ダッシュボードは中身が静的な HTML(rewrite)なので、アプリの中の遷移ではなく普通のリンクで開く */}
      <a href={LEGACY.href} className="nv">
        <span className="ic" aria-hidden="true">{LEGACY.icon}</span>
        <span className="lb">{LEGACY.label}</span>
      </a>
    </nav>
  );
}
