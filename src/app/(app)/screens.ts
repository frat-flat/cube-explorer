// 1つのアプリの枠(上の帯と左のメニュー)に出す画面の一覧。まだない画面(Saving・照合・Column Registry・Library・World・履歴・ホーム)は出さない(P1)。
// 見出しや考え方の名前は英語、添え書きと操作は日本語(D-015)。

export type Screen = {
  href: string;
  /** メニューの区切りの見出し・今いる場所の前半(「見る › Table」の「見る」)。ない画面は区切りの見出しなし */
  group?: string;
  label: string;
  /** 英語の名前に添える日本語 */
  note?: string;
  icon: string;
};

export const SCREENS: Screen[] = [
  { href: "/migrate", group: "取り込む", label: "Import", note: "ファイルから取り込む", icon: "⇪" },
  { href: "/table", group: "見る", label: "Table", note: "表で見る", icon: "▦" },
  { href: "/settings", label: "設定", icon: "⚙" },
];

/** 旧ダッシュボード(public/sheets/axes.html)。P2 で外すまで、メニューの下に置く */
export const LEGACY: Screen = { href: "/", label: "旧ダッシュボード", icon: "↩" };

/** いま開いている画面か(/table?def=x や /table/… も /table とみなす) */
export const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** 今いる場所(「見る › Table」)。一覧にない画面なら null */
export function placeOf(pathname: string): string | null {
  const s = SCREENS.find((x) => isCurrent(pathname, x.href));
  return s ? (s.group ? `${s.group} › ${s.label}` : s.label) : null;
}
