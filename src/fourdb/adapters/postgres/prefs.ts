// アカウント(principal)ごとの設定(fourdb.principal_pref。0006)の読み書き(つなぎ)。SQL だけを書き、形の確かめと既定は芯(core/prefs)。
// principal は SQL のパラメータ(scope.principal)で絞り、行ごとの権限(RLS: principal = fourdb.current_principal())が重ねて守る。
// 新しい設定(GUC)・権限・関数は作らない(withScope が入れる fourdb.principal だけを使う)。
//
// 表がない(0006 をまだ流していない・元に戻した)・実行用の役割に権限がないときは「使えない」として扱い、エラーにしない:
//   GET(getPrefs)は available: false と既定の設定、PUT(putPrefs)は PrefsUnavailable(API は 503 prefs_unavailable)。
// 使えると分かったらプロセスの中で覚える(毎回は確かめない)。覚えたあとで表が消えた・権限が外れたときは、
// その要求の読み書きが 42P01・42501 で止まるので、覚えたことを忘れて「使えない」として返し、次の要求で確かめ直す。
import { isTheme, parsePrefsLenient, type Prefs, type PrefsPatch } from "@/fourdb/core/prefs";
import { withScope, type Scope, type Tx } from "./db";
import { ImportError } from "./import-store";

/** GET/PUT /api/4db/prefs の中身(API はこのまま返す) */
export type PrefsState = { available: boolean; saved: boolean; prefs: Prefs };

/** 表に入っている形のまま(look の中身は確かめていない)。芯の parsePrefsLenient に渡して読む */
export type StoredPrefs = { theme: string | null; world: string; look: unknown };

/** 表がない・権限がないので、設定を保存できない(API は 503 code: "prefs_unavailable") */
export class PrefsUnavailable extends Error {
  constructor() {
    super("アカウントの設定を保存する表が、まだ使えません");
  }
}

const TIMEOUT = "5s";
/** 表の決まり(0006 の check)と同じ形。つなぎだけが呼ばれたときも、データベースの 500 にせず 400 で断る */
const WORLD_FORM = /^[a-z][a-z0-9_-]{0,31}$/;
const PATCH_KEYS = new Set(["theme", "world", "look"]);
/** 表がない(42P01)・名前空間がない(3F000)・権限がない(42501。RLS の with check に当たったときも同じ番号) */
const UNAVAILABLE_CODES = new Set(["42P01", "3F000", "42501"]);

let knownAvailable = false;

/** 使えると覚えたことを忘れる(次の要求で確かめ直す)。試験と、読み書きが「使えない」理由で止まったときに使う */
export function forgetPrefsAvailability(): void {
  knownAvailable = false;
}

const codeOf = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : undefined;

/** 「使えない」と分かったときに記録へ残した番号(SQLSTATE)。同じ番号は、プロセスで 1 度だけ残す(使えないあいだは要求のたびに確かめ直すので、そのたびには残さない) */
const warnedCodes = new Set<string>();

/** 記録に残した番号を忘れる(試験用) */
export function resetPrefsWarnings(): void {
  warnedCodes.clear();
}

/** 「表がない・権限がない」に運用の人が気づけるよう、番号だけを console.warn に残す。エラーのメッセージ・SQL・値は出さない */
function warnUnavailable(code: string): void {
  if (warnedCodes.has(code)) return;
  warnedCodes.add(code);
  console.warn("fourdb: アカウントの設定の表が使えません", { code });
}

/** 読み書きが「表がない・権限がない」で止まったか(止まったら、覚えたことを忘れる) */
function isUnavailableError(e: unknown): boolean {
  const code = codeOf(e);
  if (code !== undefined && UNAVAILABLE_CODES.has(code)) {
    knownAvailable = false;
    warnUnavailable(code);
    return true;
  }
  return false;
}

const unavailable = (): PrefsState => ({ available: false, saved: false, prefs: parsePrefsLenient(undefined) });

/**
 * 表と権限を確かめる(エラーにしない)。名前ではなくカタログの oid で引くので、表・名前空間がなくても、名前空間の権限がなくても止まらない。
 * 権限は SELECT・INSERT・UPDATE を 1 つずつ確かめる(has_table_privilege に 'SELECT, INSERT, UPDATE' とまとめて渡すと、
 * どれか 1 つでもあれば true になるため)。RLS が有効で強制(FORCE)になっていることも見る(なっていなければ使わない)。
 */
export async function probePrefs(tx: Tx): Promise<{ present: boolean; allowed: boolean }> {
  const [r] = await tx<{ present: boolean; allowed: boolean }[]>`
    select c.oid is not null as present,
           coalesce(c.relrowsecurity and c.relforcerowsecurity
                    and pg_catalog.has_schema_privilege(n.oid, 'USAGE')
                    and pg_catalog.has_table_privilege(c.oid, 'SELECT')
                    and pg_catalog.has_table_privilege(c.oid, 'INSERT')
                    and pg_catalog.has_table_privilege(c.oid, 'UPDATE'), false) as allowed
      from (select 1) as one
      left join pg_catalog.pg_namespace n on n.nspname = 'fourdb'
      left join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = 'principal_pref' and c.relkind = 'r'`;
  return { present: r?.present === true, allowed: r?.allowed === true };
}

/** 使えるか(使えると分かったらプロセスで覚える。使えないときは覚えず、次も確かめる) */
export async function prefsAvailable(tx: Tx): Promise<boolean> {
  if (knownAvailable) return true;
  const p = await probePrefs(tx);
  knownAvailable = p.present && p.allowed;
  // 確かめの結果には番号がないので、同じ意味の番号で残す(表がない = 42P01、権限がない・行ごとの権限が強制されていない = 42501)
  if (!p.present) warnUnavailable("42P01");
  else if (!p.allowed) warnUnavailable("42501");
  return knownAvailable;
}

/** 自分の行を読む(なければ null)。withScope の中で、表が使えると分かってから呼ぶ */
export async function readPrefsRow(tx: Tx, scope: Scope): Promise<StoredPrefs | null> {
  const [r] = await tx<StoredPrefs[]>`
    select p.theme, p.world, p.look from fourdb.principal_pref p where p.principal = ${scope.principal}`;
  return r ?? null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => Object.prototype.toString.call(v) === "[object Object]";

/** 芯(parsePrefsPatch)で確かめ済みのはずの指定を、形だけもう一度見る(違えば 400)。look の中身(許可リスト)は芯が見る */
function checkPatch(patch: PrefsPatch): void {
  if (!isPlainObject(patch)) throw new ImportError("設定の指定の形が違います", 400);
  const keys = Reflect.ownKeys(patch);
  if (keys.length === 0 || keys.some((k) => typeof k !== "string" || !PATCH_KEYS.has(k))) throw new ImportError("設定の指定の形が違います", 400);
  if ("theme" in patch && patch.theme !== null && !isTheme(patch.theme)) throw new ImportError("設定の指定の形が違います", 400);
  if ("world" in patch && (typeof patch.world !== "string" || !WORLD_FORM.test(patch.world))) throw new ImportError("設定の指定の形が違います", 400);
  if ("look" in patch && !isPlainObject(patch.look)) throw new ImportError("設定の指定の形が違います", 400);
}

/**
 * 自分の行に、送られた欄だけを書く(行がなければ作る。送られなかった欄は、作るときは表の既定、あるときは今のまま)。updated_at を今にする。
 * 書いたあとの行を返す。表の名前・列の名前は固定で、値はすべてパラメータ。
 * principal がトランザクションの利用者と違えば、RLS(with check)で 42501 になって何も書かない。
 */
export async function upsertPrefs(tx: Tx, scope: Scope, patch: PrefsPatch): Promise<StoredPrefs> {
  checkPatch(patch);
  const has = (k: keyof PrefsPatch) => Object.prototype.hasOwnProperty.call(patch, k);
  const [r] = await tx<StoredPrefs[]>`
    insert into fourdb.principal_pref as p (principal, theme, world, look)
    values (${scope.principal},
            ${has("theme") ? tx`${patch.theme ?? null}` : tx`default`},
            ${has("world") ? tx`${patch.world!}` : tx`default`},
            ${has("look") ? tx`${tx.json(patch.look as unknown as Parameters<Tx["json"]>[0])}` : tx`default`})
    on conflict (principal) do update set
      theme = ${has("theme") ? tx`excluded.theme` : tx`p.theme`},
      world = ${has("world") ? tx`excluded.world` : tx`p.world`},
      look = ${has("look") ? tx`excluded.look` : tx`p.look`},
      updated_at = now()
    returning p.theme, p.world, p.look`;
  return r;
}

/** GET: 自分の設定(保存していなければ既定と saved: false。表が使えなければ available: false と既定)。エラーにするのは、それ以外の故障だけ */
export async function getPrefs(scope: Scope): Promise<PrefsState> {
  try {
    return await withScope(scope, async (tx) => {
      const [, ok] = await Promise.all([tx`select set_config('statement_timeout', ${TIMEOUT}, true)`, prefsAvailable(tx)]);
      if (!ok) return unavailable();
      const row = await readPrefsRow(tx, scope);
      return { available: true, saved: row !== null, prefs: parsePrefsLenient(row ?? undefined) };
    });
  } catch (e) {
    if (isUnavailableError(e)) return unavailable();
    throw e;
  }
}

/**
 * PUT: 送られた欄だけを書き、書いたあとの設定を返す。patch は芯の parsePrefsPatch で確かめ済みのもの。
 * 表が使えなければ PrefsUnavailable(API は 503)。表の決まり(check)に当たれば ImportError(400)。
 */
export async function putPrefs(scope: Scope, patch: PrefsPatch): Promise<PrefsState> {
  checkPatch(patch);
  try {
    return await withScope(scope, async (tx) => {
      const [, ok] = await Promise.all([tx`select set_config('statement_timeout', ${TIMEOUT}, true)`, prefsAvailable(tx)]);
      if (!ok) throw new PrefsUnavailable();
      const row = await upsertPrefs(tx, scope, patch);
      return { available: true, saved: true, prefs: parsePrefsLenient(row) };
    });
  } catch (e) {
    if (e instanceof PrefsUnavailable) throw e;
    if (isUnavailableError(e)) throw new PrefsUnavailable();
    if (codeOf(e) === "23514") throw new ImportError("設定の値が正しくありません", 400);   // 表の決まり(形・大きさ)に当たった
    throw e;
  }
}
