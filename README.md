# cube-explorer(4D Base)

シートの列を軸の辞書に照らして登録し、箱(法人などの入れ物)とキューブ(3軸が決まった店舗など)をまたいで1枚のシートにまとめるためのアプリです。仕様は [docs/4db/](./docs/4db/DECISIONS.md)、この環境の決まりは [docs/deployment/](./docs/deployment/ENVIRONMENT.md) を参照してください([DESIGN.md](./DESIGN.md) は旧設計と決定記録です)。

入口(`/`)は 4D Base のダッシュボード(`public/sheets/axes.html`)です。ファイル(Google スプレッドシート)から 4D Base の新しい表(fourdb)へ移す画面は `/migrate`(Import)、移したデータを行・列・段を選んだ表で見る画面は `/table`(Table。以前の `/sheet` は `/table` へ転送します)、見た目(暗い・明るい)の設定は `/settings` です。この 3 つはロゴの帯と左のメニューのある1つの枠(`src/app/(app)/`)に入っています(手元での動かし方は [ENVIRONMENT.md](./docs/deployment/ENVIRONMENT.md))。データはブラウザに保存し、Supabase の設定があればログインした人ごとに Supabase にも保存します。

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
| `npm run fourdb:migrate` | 4D Base の表(fourdb)を作る・更新する(`FOURDB_ADMIN_URL` が要る) |
| `node scripts/dev-fourdb.mjs --fixture` | 手元のデータベースと試験用のスプシで、新しい画面を http://localhost:3100 で動かす |

## 構成

- `public/sheets/axes.html` ダッシュボード本体(three.js の単体ページ)
- `src/app/api/sheets/read/` スプシのリンクを読む API。`src/lib/google/sheets.ts` がサービスアカウントで Google Sheets API を読む
- `src/app/api/workspace/` ダッシュボードの中身を Supabase に読み書きする API(`src/lib/supabase/workspace.ts`)
- `src/app/login/` `src/app/api/auth/` `src/proxy.ts` ログイン(Neon Auth のメール6桁コード)
- `src/fourdb/` 4D Base の芯(`core`)と、つなぎ(`adapters`: postgres・google-sheets)。設計は [docs/4db/DATA_MODEL.md](./docs/4db/DATA_MODEL.md)
- `src/app/(app)/` 枠(ロゴの帯・左のメニュー)と、その中の画面(`migrate/` 取り込み・`table/` 表で見る・`settings/` 設定)。`src/styles/` 色(`tokens.css`。元は `tools/design/tokens.mjs`、`npm run tokens` で作り直す)と部品。`src/app/api/4db/` API(`src/lib/fourdb.ts` がログインした人と workspace を決める)
- `e2e/` 画面テスト

## 環境変数

| 項目 | 内容 |
|---|---|
| `NEON_AUTH_BASE_URL` | Neon Auth の Auth URL |
| `NEON_AUTH_COOKIE_SECRET` | ログインのクッキーに使う秘密の値 |
| `ALLOWED_EMAILS` | ログインして見てよいメールアドレス(カンマ区切り) |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | (任意)ダッシュボードの中身を保存する Supabase の Project URL と Secret key。鍵はサーバーだけが使う |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | (任意)スプシのリンクを読むサービスアカウントの鍵 JSON。読むスプシはその `client_email` に閲覧者として共有する |
| `FOURDB_DATABASE_URL` | (任意)4D Base の表(fourdb)に接続する実行用の役割の接続先。新しい画面(`/migrate`・`/table`)で使う |

公開(Vercel)するときは、上の環境変数を入れ、Neon Auth の Trusted domains に公開先のドメインを足します。Neon Auth の標準のメール送信は開発用なので、本番で人を増やすときは自前のメール送信(SMTP)を設定します。

## データベースについて

ダッシュボードの中身は Supabase の表 `cube_workspaces`(ログインした人のメールアドレスごとに1件、中身は JSON)に保存します。表は `supabase/migrations/0001_cube_workspaces.sql` で作ります。RLS をオンにして方針を置かないので、公開用の鍵からは読めず、アプリのサーバーが Secret key で読み書きします。開くと Supabase の中身を正として読み込み、まだ無ければブラウザの中身を最初の保存として送ります。

ログインの情報は Neon Auth が持ちます。以前の入金キューブの表は 2026-10-05 に消しました。中身は Neon のバックアップ用ブランチ `backup-old-model-2026-10-05` に残っています。
