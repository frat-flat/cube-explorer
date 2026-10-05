# cube-explorer(軸の辞書と箱)

シートの列を軸の辞書に照らして登録し、箱(法人などの入れ物)とキューブ(3軸が決まった店舗など)をまたいで1枚のシートにまとめるためのアプリです。設計は [DESIGN.md](./DESIGN.md) を参照してください。

入口(`/`)は「軸の辞書と箱」のダッシュボード(`public/sheets/axes.html`)です。データは今のところブラウザに保存し、データベースは使いません。

## 必要なもの

- Node.js 22 以上

## はじめかた

```bash
npm install
npm run dev           # http://localhost:3000
```

環境変数を何も書かずに `npm run dev` すると、ログインなしで動きます。

## よく使うコマンド

| コマンド | 内容 |
|---|---|
| `npm test` | 単体テスト(Vitest) |
| `npm run test:e2e` | 画面テスト(Playwright) |
| `npm run typecheck` / `npm run lint` | 型チェック / Lint |

## 構成

- `public/sheets/axes.html` ダッシュボード本体(three.js の単体ページ)
- `src/app/api/sheets/read/` スプシのリンクを読む API。`src/lib/google/sheets.ts` がサービスアカウントで Google Sheets API を読む
- `src/app/login/` `src/app/api/auth/` `src/proxy.ts` ログイン(Neon Auth のメール6桁コード)
- `e2e/` 画面テスト

## 環境変数

| 項目 | 内容 |
|---|---|
| `NEON_AUTH_BASE_URL` | Neon Auth の Auth URL |
| `NEON_AUTH_COOKIE_SECRET` | ログインのクッキーに使う秘密の値 |
| `ALLOWED_EMAILS` | ログインして見てよいメールアドレス(カンマ区切り) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | (任意)スプシのリンクを読むサービスアカウントの鍵 JSON。読むスプシはその `client_email` に閲覧者として共有する |

公開(Vercel)するときは、上の環境変数を入れ、Neon Auth の Trusted domains に公開先のドメインを足します。Neon Auth の標準のメール送信は開発用なので、本番で人を増やすときは自前のメール送信(SMTP)を設定します。

## データベースについて

今のアプリはデータベースを使いません(ログインの情報だけ Neon Auth が持ちます)。以前の入金キューブの表は 2026-10-05 に消しました。中身は Neon のバックアップ用ブランチ `backup-old-model-2026-10-05` に残っています。
