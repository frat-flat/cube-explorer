# この環境の決まり(cube-explorer)

4D Base の仕様(どの組み込み先でも共通)は [../4db/](../4db/DECISIONS.md) にある。ここには、このリポジトリ・この公開先だけの決まりと構成を書く。
Synapse などへ組み込むときは、その組み込み先の分をこの文書と同じ形で作る。

## ユーザーの決定

| 日付 | 決定 |
|---|---|
| 2026-10-08 | 使うのは当面ユーザー本人だけ。データはログインした人ごとに持ち、共有はあとから足せる形にする |
| 2026-10-08 | 本番に入っているデータは試しに触っただけで、消えてもよい。旧 `cube_workspaces`(1人1件の JSON)から新しい形への移行手順は作らない。実際に消すときは改めて確認する |

## 構成(2026-10-08 時点)

| 役割 | 使っているもの | 備考 |
|---|---|---|
| 画面の公開 | Vercel(プロジェクト `cube-explorer`) | PR ごとにプレビューが出る |
| ログイン | Neon Auth(メールの6桁コード) | `ALLOWED_EMAILS` に入れた人だけ。入口は `src/proxy.ts` |
| データ(旧) | Supabase の `cube_workspaces` | ログインした人(メールアドレス)ごとに1件の JSON。上限 5MB。サーバーが秘密の鍵で読み書きする |
| スプシの読み取り | Google のサービスアカウント | 閲覧のみ(`spreadsheets.readonly`)。読ませたいスプシをこのアカウントに共有する |

環境変数(名前だけ): `NEON_AUTH_BASE_URL`・`NEON_AUTH_COOKIE_SECRET`・`ALLOWED_EMAILS`・`SUPABASE_URL`・`SUPABASE_SECRET_KEY`・`GOOGLE_SERVICE_ACCOUNT_JSON`。

## 4D Base の芯の表(fourdb)につなぐときの決まり

[DATA_MODEL.md](../4db/DATA_MODEL.md) 3.9 のとおり。この環境では次のようにする(まだ本番にはつないでいない)。

- 表を作る役割(持ち主)と、アプリが接続する実行用の役割を分ける。実行用の役割は superuser でも BYPASSRLS でもなく、`fourdb` の表の読み書きと関数の実行だけを渡す。アプリは最初の接続で役割を確かめ、superuser・BYPASSRLS・表の持ち主なら止まる(fail-closed)。
- アプリはトランザクションごとに `fourdb.principal` と `fourdb.workspace_id` を設定してから読み書きする(`set_config(…, true)`)。所属(`workspace_member`)を確かめてから workspace を設定する。
- principal はログイン(Neon Auth)のユーザー ID を使い、`neon:<ユーザー ID>` の形にする。メールアドレスは表示用。入口の許可リスト(`ALLOWED_EMAILS`)と、workspace の所属の両方を確かめる。
- 手元の開発用の利用者(ログインの設定がないときの `local-dev`)は、本番のデータベースにつながない。

## 未確認のこと

- 本番がつないでいる Supabase のプロジェクト。2026-10-08 に接続できる Supabase の組織には、4D Base 用と分かるプロジェクトが見当たらなかった。
- Vercel の環境変数の設定状況。2026-10-08 時点で、接続した Vercel のツールからはこのプロジェクトが見えず、手元の Vercel CLI はユーザー名(日本語)を HTTP ヘッダーに入れられずにエラーになった。

## 手元での起動

[README](../../README.md) のとおり `npm run dev`。手元の `.env.local` にはログイン(Neon Auth)の設定だけがあり、スプシのリンク読み取りと Supabase への保存は手元では動かない(2026-10-08 時点)。

### 4D Base の新しい画面(/migrate)を手元で動かす

本番のデータベースはまだない(置き場所と費用は未決)ので、手元の使い捨てデータベースで動かす。パソコンの PostgreSQL(18)の、すでに動いているもの(5432 番)は使わず、別のフォルダに別のものを立てる。

```bash
# 1. 使い捨てのデータベースを立てる(フォルダは .gitignore の外ならどこでもよい。パスワードなし・手元だけ)
"C:/Program Files/PostgreSQL/18/bin/initdb.exe" -D <フォルダ> -U fourdb -A trust -E UTF8 --locale=C
"C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe" -D <フォルダ> -o "-p 55432 -c listen_addresses=localhost" -l <フォルダ>/pg.log start
"C:/Program Files/PostgreSQL/18/bin/createdb.exe" -h localhost -p 55432 -U fourdb fourdb_dev
# 2. fourdb の表を作り、実行用の役割 fourdb_app_local を作って権限を渡す
FOURDB_ADMIN_URL=postgres://fourdb@localhost:55432/fourdb_dev FOURDB_APP_ROLE=fourdb_app_local npm run fourdb:migrate
# 3. 起動(ログインなし。--fixture を付けると e2e/fixtures/sheets の試験用スプシを読む)→ http://localhost:3100/migrate
node scripts/dev-fourdb.mjs --fixture
```

本物のスプシを読むときは、`--fixture` を付けず、`.env.local` に `GOOGLE_SERVICE_ACCOUNT_JSON` を入れる(鍵は秘密の値なので、利用者が自分で入れる)。

### 試験

```bash
# 単体と、データベースを使う結合(使い捨てのデータベースの中を毎回作り直す。fourdb_it は空のデータベースを作っておく)
FOURDB_TEST_ADMIN_URL=postgres://fourdb@localhost:55432/fourdb_it npx vitest run
# 画面(上の 3 で起動しておく)
E2E_4DB_URL=http://localhost:3100 npx playwright test e2e/migrate.spec.ts
```
