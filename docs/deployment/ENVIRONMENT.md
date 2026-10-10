# この環境の決まり(cube-explorer)

4D Base の仕様(どの組み込み先でも共通)は [../4db/](../4db/DECISIONS.md) にある。ここには、このリポジトリ・この公開先だけの決まりと構成を書く。
Synapse などへ組み込むときは、その組み込み先の分をこの文書と同じ形で作る。

## ユーザーの決定

| 日付 | 決定 |
|---|---|
| 2026-10-08 | 使うのは当面ユーザー本人だけ。データはログインした人ごとに持ち、共有はあとから足せる形にする |
| 2026-10-08 | 4D Base の表(fourdb)は Neon に置く。ログイン(Neon Auth)と同じプロジェクト・同じデータベース(neondb)。このプロジェクトのデータは膨大にならないので、Neon の範囲に収まる見込み |
| 2026-10-08 | 本番に入っているデータは試しに触っただけで、消えてもよい。旧 `cube_workspaces`(1人1件の JSON)から新しい形への移行手順は作らない。実際に消すときは改めて確認する |
| 2026-10-09 | 旧ダッシュボード(`public/sheets/axes.html`)は P2 で外す。以後、旧データ(Supabase の `cube_workspaces` と、ブラウザの `axis-boxes-v2*`)は読みも書きもしない。旧データを消すこと(Supabase の表・鍵、Vercel の環境変数)は、この区切りではせず、別に確かめる(DECISIONS.md の D-013・D-016) |
| 2026-10-10 | D-017: ホームは World の舞台に立体の Box を並べる。見た目(Visual)・明暗・World は、アカウントごとに本番の DB に覚える(表 `principal_pref`、0006)。計算された値(ƒ)の判定を速くする索引 0007 も足す。本番には、承認を得てから流す(DECISIONS.md の D-017) |

## 構成(2026-10-10・P2 のあと)

| 役割 | 使っているもの | 備考 |
|---|---|---|
| 画面の公開 | Vercel(プロジェクト `cube-explorer`) | PR ごとにプレビューが出る |
| ログイン | Neon Auth(メールの6桁コード) | `ALLOWED_EMAILS` に入れた人だけ。入口は `src/proxy.ts` |
| データ(新) | Neon の `fourdb`(下の「4D Base の芯の表」) | 画面はすべてここだけを読み書きする(データの流れは「画面 → `/api/4db/*` → `requireScope` → `withScope` → つなぎの関数」の 1 本) |
| アカウントの設定 | Neon の `fourdb.principal_pref`(0006) | 明暗・World・ホームの見た目を、アカウント(principal)ごとに 1 行。ブラウザのクッキー `fourdb_theme` は明暗の写し(下の「アカウントごとの設定の覚え方」) |
| データ(旧・使わない) | Supabase の `cube_workspaces` | P2 で旧ダッシュボードと一緒に、読み書きするコード(`/api/workspace`・`src/lib/supabase/`)を外した。表と鍵は、まだ消していない(下の「旧データを消すときに確かめること」) |
| スプシの読み取り | Google のサービスアカウント | 閲覧のみ(`spreadsheets.readonly`)。読ませたいスプシをこのアカウントに共有する |

環境変数(名前だけ): `NEON_AUTH_BASE_URL`・`NEON_AUTH_COOKIE_SECRET`・`ALLOWED_EMAILS`・`GOOGLE_SERVICE_ACCOUNT_JSON`・`FOURDB_DATABASE_URL`。
`SUPABASE_URL`・`SUPABASE_SECRET_KEY` は、アプリはもう読まない(P2 で `.env.example` からも外した)。Vercel に入ったままの分は、下のとおり別に確かめてから消す。
`FOURDB_ADMIN_URL`(表の持ち主の接続先)は、表を作り替える手元の `.env.local` だけに置く。**Vercel には入れない**(アプリは実行用の役割の `FOURDB_DATABASE_URL` だけを使う)。P2 で、アプリが読む環境変数は増えていない。
`FOURDB_ADMIN_URL` を空にしたままにすると、`npm run fourdb:setup-remote` は `.env.local` の `DATABASE_URL` に戻って使う。空にしない。接続先の文字列は、`sslmode=verify-full`(証明書とホスト名を検証)にしておく。Neon の既定の `sslmode=require` は、暗号化はするが、接続先の証明書は検証しない(postgres.js の扱い)。

## 旧データを消すときに確かめること(未実施。P2 ではしない)

旧ダッシュボードを外したので、次は誰も読み書きしない。消す前に、ユーザーの確認と、消したあとに困らないことの確認が要る(2026-10-08 の決定: 実際に消すときは改めて確認する)。

- Supabase の表 `cube_workspaces` と、その鍵(Project URL・Secret key)。表は消すと戻せない。
- Vercel の環境変数 `SUPABASE_URL`・`SUPABASE_SECRET_KEY`(Production・Preview・Development のどれに入っているか)。
- ブラウザの `localStorage` の `axis-boxes-v2*`(利用者の手元に残る。アプリはもう読まない)。
- 表を作っていた SQL(`supabase/migrations/0001_cube_workspaces.sql`)は、表を消すまで記録として残す(アプリからは使わない)。表を消したら一緒に外す。

<!-- P2: 本番に 0006・0007 を流したあと、ここ(「4D Base の芯の表(fourdb)を Neon に用意する」の前)に「本番(Neon)の fourdb の状態」の節を足す(流した日・承認・流したあとの確認・流す前の value の行数など、流したあとにしか分からない値を入れる)。足したら、「4D Base の芯の表(fourdb)につなぐときの決まり」の最初の文から、その節を指すようにする -->

## 4D Base の芯の表(fourdb)を Neon に用意する

```bash
# .env.local に FOURDB_ADMIN_URL(Neon の画面の「Connect」で出る neondb_owner の接続先)を入れてから
npm run fourdb:setup-remote
```

表を作り、実行用の役割 `fourdb_app`(パスワードはランダム)を作って、その接続先を `.env.local` の `FOURDB_DATABASE_URL` に書く(値は画面に出さない)。公開(Vercel)するときは、同じ値を Vercel の環境変数 `FOURDB_DATABASE_URL` に入れる。

表の作り替え(`migrations/` に新しい番号のファイルが増えたとき)も同じコマンドで流す。役割がすでにあればパスワードは変えず、まだ流していないファイルだけを流して権限を渡し直す。新しいコードを公開する前に流す(例: 0003・0004 がないと、表で見る画面 `/table`(以前の `/sheet`)と集計が動かない。0006 がないと、見た目・明暗・World がアカウントに保存されない(画面は「このパソコンにだけ覚えます」になる)。0007 がないと、ホームの数値の欄の ƒ の判定が遅い)。本番のデータベースを変えるので、流す前にユーザーの承認を得る。

## 4D Base の芯の表(fourdb)につなぐときの決まり

[DATA_MODEL.md](../4db/DATA_MODEL.md) 3.9 のとおり。この環境では次のようにする(本番は Neon の fourdb につないでいる。用意のしかたは上の「4D Base の芯の表(fourdb)を Neon に用意する」)。

- 表を作る役割(持ち主)と、アプリが接続する実行用の役割を分ける。実行用の役割は superuser でも BYPASSRLS でもなく、`fourdb` の表の読み書きと関数の実行だけを渡す。アプリは最初の接続で役割を確かめ、superuser・BYPASSRLS・表の持ち主なら止まる(fail-closed)。
- アプリはトランザクションごとに `fourdb.principal` と `fourdb.workspace_id` を設定してから読み書きする(`set_config(…, true)`)。所属(`workspace_member`)を確かめてから workspace を設定する。
- principal はログイン(Neon Auth)のユーザー ID を使い、`neon:<ユーザー ID>` の形にする。メールアドレスは表示用。入口の許可リスト(`ALLOWED_EMAILS`)と、workspace の所属の両方を確かめる。
- 手元の開発用の利用者(ログインの設定がなく、`FOURDB_LOCAL_DEV=1` を付けたときの `local-dev`)は、本番のデータベースにつながない。`FOURDB_LOCAL_DEV=1` がなければ、ログインの設定がなくても 4D Base の API は 401 になる。

## アカウントごとの設定の覚え方(D-017・0006)

画面の見た目(Visual)・明暗・World は、**アカウント(principal)ごと**に覚える。どのパソコンで開いても同じになる。workspace ごとではない(共有を足しても、見た目は人ごとに別にするため)。

| 置き場所 | 中身 | 役目 |
|---|---|---|
| Neon の `fourdb.principal_pref`(0006) | 明暗(`dark`・`light`・なし)・World の id・見た目の部品(`look`) | **アカウントの正本** |
| クッキー `fourdb_theme` | `dark` か `light` | 明暗の写し。最初の HTML で明暗を決めて、ちらつかせない。JS から書くので HttpOnly ではない。決まった値だけを受け付ける |
| localStorage `fourdb.prefs.pending` | 送れなかった変更 | 次のタブの読み込みで、先に送る |

- 読み書き: `GET /api/4db/prefs`(タブの読み込みごとに 1 回)と `PUT /api/4db/prefs`(変えたとき)。`requireScope` を通し、PUT は同じサイトからだけ(別のサイトは 403)。本文は 4KB まで。
- 送り方: 明暗・World はすぐ送る。見た目の部品は 800ms まとめて送る。送る要求は同時に 1 つ。ページを離れる・隠れたときは、送っていない分を `keepalive` で送る。失敗した分は localStorage に残し、「もう一度試す」で送り直す。
- タブの読み込みごとの突き合わせ: (1) 送っていない変更があれば先に送る(この端末の変更が勝つ)、(2) アカウントに保存がなければ、クッキーの明暗を送って移す、(3) 保存があってクッキーと違えば、クッキーと画面をアカウントに合わせる。
- 書くときは厳しく、読むときはゆるく: PUT は、キーが `theme`・`world`・`look` のどれかで、`look` の 6 つの部品(形・向き・台座・札・背景・並べ方)は許可リストの値だけ(知らないキー・値、`__proto__`・`constructor` は 400)。読むときは、知らない値は既定に直す。許可リストと既定は `src/fourdb/core/prefs/`。DB の表は形と大きさ(2KB まで)だけを見るので、部品や World が増えても、表の作り替えは要らない。
- 表が使えないとき(0006 を流す前、元に戻したあと、実行用の役割に権限がないとき): GET は `available: false` と既定の設定(200)、PUT は 503 `code: "prefs_unavailable"`。画面は「いまはこのパソコンにだけ覚えます(アカウントへの保存は準備中です)」と出し、クッキーだけで動く。アプリは、表と権限(SELECT・INSERT・UPDATE を 1 つずつ)と、行ごとの権限の強制を確かめ、使えると分かったらプロセスで覚える。
- DB の守り: `principal_pref` は行ごとの権限(RLS)を有効かつ強制(FORCE)にし、方針 `principal_scope` で `principal = fourdb.current_principal()` の行だけを読み書きできる。つなぎ(`adapters/postgres/prefs.ts`)も SQL のパラメータで principal を絞る(RLS は重ねの守り)。新しい設定(GUC)・SECURITY DEFINER の関数は作っていない。実行用の役割への権限は、`setup-remote` の `grantApp` が渡す(表の SQL に役割の名前を書かない)。
- DB のない開発サーバー(`FOURDB_DATABASE_URL` なし)では、設定の要求を出さない。ログインなしの開発用の利用者(`local-dev`)は、手元の DB にしかつながらない。
- 元に戻す: `0006_principal_pref.down.sql`。保存された設定が 1 行でもあれば、消さずに止まり、行の数を知らせる。消すと決めたときだけ、**取引の中で** `begin; set local fourdb.discard_principal_pref = '<その数>'; <down の SQL>; commit;` の形で流し直す(数が今の行の数と同じときだけ通る。`local` なしの `set` は接続に残るので使わない)。流したあとは `fourdb_migrations.applied` から行を消す。手順は本番の手順書(P2-runbook。リポジトリには入れていない)の 9.4。
- 計算された値の索引 0007(`value_calculated`)は、ホームの「数値」の欄の ƒ の判定(`value.kind = 'calculated'` の今の版があるか)に使う。作る間は `value` への書き込みが待たされる(読むのは止まらない)ので、取り込みの反映をしていない時間に流す。

## 未確認のこと

- 本番がつないでいる Supabase のプロジェクト。2026-10-08 に接続できる Supabase の組織には、4D Base 用と分かるプロジェクトが見当たらなかった。
- Vercel の環境変数の設定状況。2026-10-08 時点で、接続した Vercel のツールからはこのプロジェクトが見えず、手元の Vercel CLI はユーザー名(日本語)を HTTP ヘッダーに入れられずにエラーになった。
- Vercel の Preview の公開が、本番の DB につながっているか(`FOURDB_DATABASE_URL` の対象に Preview が含まれるか)。含まれていれば、Preview で保存した設定は本番の `principal_pref` に入る。

## 手元での起動

[README](../../README.md) のとおり `npm run dev`。手元の `.env.local` にはログイン(Neon Auth)の設定だけがあり、スプシのリンク読み取りは手元では動かない(2026-10-08 時点。試験用のスプシ `--fixture` なら動く)。

### 4D Base の画面(/ ホーム・/tasks・/migrate・/table・/history・/settings)を手元で動かす

本番のデータベース(Neon)には、承認なしにつながない。画面の試験は、手元の使い捨てデータベースで動かす。パソコンの PostgreSQL(18)の、すでに動いているもの(5432 番)は使わず、別のフォルダに別のものを立てる。

```bash
# 1. 使い捨てのデータベースを立てる(フォルダは .gitignore の外ならどこでもよい。パスワードなし・手元だけ)
"C:/Program Files/PostgreSQL/18/bin/initdb.exe" -D <フォルダ> -U fourdb -A trust -E UTF8 --locale=C
"C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe" -D <フォルダ> -o "-p 55432 -c listen_addresses=localhost" -l <フォルダ>/pg.log start
"C:/Program Files/PostgreSQL/18/bin/createdb.exe" -h localhost -p 55432 -U fourdb fourdb_dev
# 2. fourdb の表を作り、実行用の役割 fourdb_app_local を作って権限を渡す
FOURDB_ADMIN_URL=postgres://fourdb@localhost:55432/fourdb_dev FOURDB_APP_ROLE=fourdb_app_local npm run fourdb:migrate
# 3. 起動(ログインなし。--fixture を付けると e2e/fixtures/sheets の試験用スプシを読む)→ http://localhost:3100/(ホーム)・/tasks(Task)・/migrate(取り込み)・/table(表で見る。以前の /sheet は転送される)・/history(履歴)・/settings(見た目・アカウント)
node scripts/dev-fourdb.mjs --fixture
```

本物のスプシを読むときは、`--fixture` を付けず、`.env.local` に `GOOGLE_SERVICE_ACCOUNT_JSON` を入れる(鍵は秘密の値なので、利用者が自分で入れる)。

### 試験

```bash
# 単体と、データベースを使う結合(使い捨てのデータベースの中を毎回作り直す。fourdb_it は空のデータベースを作っておく)。
# 結合のうち、集計の試験は <名前>_proj、ホーム・履歴・Box 一覧の試験は <名前>_home という別のデータベースを、試験が自動で作って使う(終わっても残るので、あとで drop する)
FOURDB_TEST_ADMIN_URL=postgres://fourdb@localhost:55432/fourdb_it npx vitest run
# 4D Base の画面(上の 3 で起動しておく。同じデータベースを使うので 1 つずつ流れる)。ホーム・履歴・API(home)、枠(shell)、ログインの失敗の文(login-error)、取り込み(migrate)、Table(sheet)
E2E_4DB_URL=http://localhost:3100 npx playwright test e2e/home.spec.ts e2e/shell.spec.ts e2e/login-error.spec.ts e2e/migrate.spec.ts e2e/sheet.spec.ts
# すべての画面テスト(ログイン・ロゴの試験も含む)。.env.local のログインの設定を空にして流す(設定があるとログインの画面になる)。4D Base は手元のデータベースへ。
# playwright が npm run dev を 3000 番で起動する(起動の確認は /login)。データベースを使う試験(home・migrate・sheet・prefs・tasks など)は、E2E_4DB_URL がないので飛ばされる
# このコマンドには FOURDB_LOCAL_DEV=1 を付けない。ログインなしの開発用の利用者(local-dev)は FOURDB_LOCAL_DEV=1 のときだけなので、ここでは 4D Base の API(設定・Task の件数)は 401 になり、
# 枠もそれを知っていて(src/lib/fourdb.ts の fourdbUsable)、それらを読みに行かない(コンソールに 401 は出ない)。データベースを使う機能は、上の node scripts/dev-fourdb.mjs(FOURDB_LOCAL_DEV=1 を付ける)で動かす
NEON_AUTH_BASE_URL= NEON_AUTH_COOKIE_SECRET= FOURDB_DATABASE_URL=postgres://fourdb_app_local@localhost:55432/fourdb_dev npx playwright test
# データベースのない開発サーバー(FOURDB_DATABASE_URL が空)で、枠が設定・Task の件数を読みに行かないことの試験(E2E_NO_DB=1 のときだけ動く。playwright が npm run dev を 3000 番で起動する)
E2E_NO_DB=1 NEON_AUTH_BASE_URL= NEON_AUTH_COOKIE_SECRET= FOURDB_DATABASE_URL= npx playwright test e2e/nodb.spec.ts
```

- 開発サーバーが画面を初めて作る(コンパイルする)時間が長いと、並列の作業者が多いとき、メニューのリンクを押したあとの移動が 5 秒の待ちに間に合わず、shell.spec の移動の試験が時間切れで落ちることがある(2026-10-11 の手元では、既定の作業者の数〔4〕で 3 件落ち、`--workers=2` なら全部通った)。落ちたら `--workers=2` で流し直す。

- 同じフォルダで `next dev` は 1 つしか動かせない(2 つ目は「Another next dev server is already running」で止まる)。上の 2 つ目と 3 つ目を続けて流すときは、先に起動した開発サーバーを止める。
- 旧ダッシュボードの画面テスト(`e2e/dashboard.spec.ts`)は、P2 で旧ダッシュボードと一緒に外した。

P2 の新しい試験。上の `npx vitest run` が、新しい試験(芯の `home`・`tasks`・`prefs`、立体の純粋な計算 `ui/home3d`、API の `routes.*`・`params`、設定の送り方 `prefs-sync` など)も全部拾う。次は、結合の追加分だけを流すときと、別に流すもの(0006 の確かめ、規模の測定)。

```bash
# 結合の試験の追加分: 設定(0006)は <名前>_prefs という別のデータベースを、試験が自動で作って使う(<名前>_proj・<名前>_home と同じ。終わっても残るので、あとで drop する)
FOURDB_TEST_ADMIN_URL=postgres://fourdb@localhost:55432/fourdb_it npx vitest run src/fourdb/adapters/postgres/prefs.integration.test.ts src/fourdb/adapters/postgres/overview.integration.test.ts

# 0006 の確かめ(表の RLS の強制・方針・check・権限と、元に戻す down を、本物のファイルのまま流す)。
# 使い捨ての試験用データベース(名前が fourdb_it… か test・check・perf を含む)に 0001〜0006 を流したあと、superuser で。最後に rollback するので何も残らない。
# 「NOTICE: OK」が 48 行出れば通過(down が止まる確かめで、行の数だけを含む ERROR が 2 回出るのは想定どおり)
psql -h localhost -p 55432 -U fourdb -d <使い捨てのDB> -v ON_ERROR_STOP=1 -f src/fourdb/adapters/postgres/test/0006_principal_pref.check.sql

# ホーム・Task の規模の測定(手元の使い捨てデータベース。数分かかる)。V1 = 法人 500 + 店舗 8,000 の親子あり、V2 = 8,500 がいちばん上(scale_home.sql の -v variant=V1 か V2 で切り替える)
psql -h localhost -p 55432 -U fourdb -d <使い捨てのDB> -v ON_ERROR_STOP=1 -f src/fourdb/adapters/postgres/test/scale.sql
psql -h localhost -p 55432 -U fourdb -d <使い捨てのDB> -v ON_ERROR_STOP=1 -v variant=V1 -f src/fourdb/adapters/postgres/test/scale_home.sql
# 試験の中に書いた下書きの SQL を測る
FOURDB_SCALE_APP_URL=postgres://fourdb_scale_app@localhost:55432/<使い捨てのDB> npx vitest run src/fourdb/adapters/postgres/home.scale.test.ts --silent=false
# 製品のつなぎ(loadHome・loadTasks・countTasks)そのものを測る。DATA_MODEL.md 6章の表の数値はこちら
FOURDB_SCALE_APP_URL=postgres://fourdb_scale_app@localhost:55432/<使い捨てのDB> npx vitest run src/fourdb/adapters/postgres/home.scale.adapter.test.ts --silent=false
# 0007 のあり・なしは、superuser で migrations/0007_value_calculated_index.sql / .down.sql を流して切り替える。目安(5 回の真ん中): ホーム V1 300ms・V2 1,000ms、Task 100ms、件数 50ms
```

- 画面の試験(`e2e/home.spec.ts` ほか)の流し方は、既存の「4D Base の画面」のコマンドのまま。対象に `e2e/home.spec.ts`(ホーム・Visual・Task・履歴・設定のアカウント・3D が出ないとき・動きを減らす設定)が含まれる。
- 3D の試験は、画面なしの Chromium で WebGL を使うため、`playwright.config.ts` が `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader` を渡す(ソフトウェア描画)。3D の試験は 1 つずつ流し、ルートの `data-ready="true"` を待ってから撮る。
- ビルドで確かめること: (1) `npm ls three` で `three` が 1 つだけ入っていること。(2) `npx next build` のあと、`.next/` の中で `WebGLRenderer` を含む JS の塊が 1 つだけで、その塊を参照しているのが `(app)/page_client-reference-manifest.js`(ホーム)だけであること。(3) その塊を gzip で圧縮した大きさが 180KB までであること。
  - 2026-10-11 の手元(`npx next build` のあと)の結果: ホームの立体の塊は gzip で 142,671 バイト(上限 180KB)。`WebGLRenderer` を含む塊は 1 つだけで、参照しているのは `(app)/page_client-reference-manifest.js` だけ。`npm ls three` は `three@0.128.0` の 1 つだけ。
- 一時的に作るデータベース(`…_proj`・`…_home`・`…_prefs`)は、試験のあとに drop する。
