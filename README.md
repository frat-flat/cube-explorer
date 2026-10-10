# cube-explorer(4D Base)

シートの列を軸の辞書に照らして登録し、箱(法人などの入れ物)とキューブ(3軸が決まった店舗など)をまたいで1枚のシートにまとめるためのアプリです。仕様は [docs/4db/](./docs/4db/DECISIONS.md)、この環境の決まりは [docs/deployment/](./docs/deployment/ENVIRONMENT.md) を参照してください([DESIGN.md](./DESIGN.md) は旧設計と決定記録です)。

データは 4D Base の表(fourdb。Neon の PostgreSQL)だけに置きます。画面はすべて、ロゴの帯と左のメニューのある1つの枠(`src/app/(app)/`)に入っています(手元での動かし方は [ENVIRONMENT.md](./docs/deployment/ENVIRONMENT.md))。

| 画面 | URL | 内容 |
|---|---|---|
| ホーム | `/`(入口) | fourdb にあるものの数(ファイル・シート・移行完了のシート・Box・Card の項目・保存した表・カラム・承認待ち)と、最近の履歴 10 件。数のカードから Import・Table へ移れる |
| Import | `/migrate` | ファイル(Google スプレッドシート)から 4D Base へ移す(読み取り・承認・反映・照合) |
| Table | `/table` | 移したデータを、行・列・段を選んだ表で見る。以前の `/sheet` は `/table` へ転送します。`/table?def=<id>` は保存した表を開いた状態で出す |
| 履歴 | `/history` | 取り込み・表の保存の記録を、新しい順に 50 件ずつ。取り込みは Import へ、表の保存は Table へ移れる |
| 設定 | `/settings` | 見た目(暗い・明るい)と、ログイン中のメール・ログアウト |

以前の入口だった旧ダッシュボード(`public/sheets/axes.html`)と、その保存先 Supabase の読み書きは、2026-10-10 に外しました(Supabase の表と鍵を消すことは、別に確かめます。[ENVIRONMENT.md](./docs/deployment/ENVIRONMENT.md))。

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
| `node scripts/dev-fourdb.mjs --fixture` | 手元のデータベースと試験用のスプシで、画面を http://localhost:3100 で動かす(`--port` で番号を変えられる) |

## 構成

- `src/lib/google/sheets.ts` サービスアカウントの鍵・認証・リンクの読み方(取り込み `src/fourdb/adapters/google-sheets/` が使って、スプシを全行読む)
- `src/app/login/` `src/app/api/auth/` `src/proxy.ts` ログイン(Neon Auth のメール6桁コード)
- `src/fourdb/` 4D Base の芯(`core`)と、つなぎ(`adapters`: postgres・google-sheets)。設計は [docs/4db/DATA_MODEL.md](./docs/4db/DATA_MODEL.md)
- `src/app/(app)/` 枠(ロゴの帯・左のメニュー)と、その中の画面(`page.tsx` ホーム・`migrate/` 取り込み・`table/` 表で見る・`history/` 履歴・`settings/` 設定)。`src/styles/` 色(`tokens.css`。元は `tools/design/tokens.mjs`、`npm run tokens` で作り直す)と部品。`src/app/api/4db/` API(`src/lib/fourdb.ts` がログインした人と workspace を決める。読み取りの `summary`・`history`・`boxes` は、つなぎ `src/fourdb/adapters/postgres/{summary,history,boxes}.ts` を呼ぶ)
- `e2e/` 画面テスト

## 環境変数

| 項目 | 内容 |
|---|---|
| `NEON_AUTH_BASE_URL` | Neon Auth の Auth URL |
| `NEON_AUTH_COOKIE_SECRET` | ログインのクッキーに使う秘密の値 |
| `ALLOWED_EMAILS` | ログインして見てよいメールアドレス(カンマ区切り) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | (任意)スプシのリンクを読むサービスアカウントの鍵 JSON。読むスプシはその `client_email` に閲覧者として共有する |
| `FOURDB_DATABASE_URL` | 4D Base の表(fourdb)に接続する実行用の役割の接続先。ホーム・Import・Table・履歴で使う。未設定なら、これらの画面は「未設定」と出る |

公開(Vercel)するときは、上の環境変数を入れ、Neon Auth の Trusted domains に公開先のドメインを足します。Neon Auth の標準のメール送信は開発用なので、本番で人を増やすときは自前のメール送信(SMTP)を設定します。

## データベースについて

データは Neon の PostgreSQL の `fourdb`(名前空間)に置き、ログインした人ごとの workspace で分けます。設計は [docs/4db/DATA_MODEL.md](./docs/4db/DATA_MODEL.md)、本番での用意と手元での試験は [ENVIRONMENT.md](./docs/deployment/ENVIRONMENT.md) を見てください。

ログインの情報は Neon Auth が持ちます。以前の入金キューブの表は 2026-10-05 に消しました。中身は Neon のバックアップ用ブランチ `backup-old-model-2026-10-05` に残っています。旧ダッシュボードの保存先だった Supabase の表 `cube_workspaces` は、アプリがもう読み書きしませんが、まだ消していません(別に確かめます)。
