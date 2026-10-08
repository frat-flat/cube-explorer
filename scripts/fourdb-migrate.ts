// fourdb の表を作る・更新する(まだ流していない migration だけを流す)。表の持ち主の接続で動かす。
//   FOURDB_ADMIN_URL=postgres://<持ち主>@<host>/<db> npm run fourdb:migrate
// FOURDB_APP_ROLE を渡すと、その実行用の役割に fourdb の読み書きを渡す。役割がなければ、手元のデータベースのときだけ作る。
// 本番・リモートで流すときは、必ず事前にバックアップを取り、ユーザーの承認を得てから。
import postgres from "postgres";
import { isLocalDatabase } from "../src/fourdb/adapters/postgres/db";
import { applyMigrations, grantApp } from "../src/fourdb/adapters/postgres/migrate";

async function main() {
  const url = process.env.FOURDB_ADMIN_URL;
  if (!url) throw new Error("FOURDB_ADMIN_URL(表の持ち主の接続先)を入れてください");
  const role = process.env.FOURDB_APP_ROLE;
  const admin = postgres(url, { onnotice: () => {}, max: 1 });
  try {
    const ran = await applyMigrations(admin);
    console.log(ran.length ? `流した: ${ran.join(", ")}` : "流すものはありませんでした(すべて流し済み)");
    if (role) {
      if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`役割の名前が正しくありません: ${role}`);
      const [exists] = await admin`select 1 from pg_roles where rolname = ${role}`;
      if (!exists) {
        if (!isLocalDatabase(url)) throw new Error(`役割 ${role} がありません。リモートでは、役割は手で作ってください(superuser・BYPASSRLS にしない)`);
        await admin.unsafe(`create role ${role} login`);
        console.log(`役割 ${role} を作った(手元のデータベース用。パスワードなし)`);
      }
      await grantApp(admin, role);
      console.log(`役割 ${role} に fourdb の読み書きを渡した`);
    }
  } finally {
    await admin.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
