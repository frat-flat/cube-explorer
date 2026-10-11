// アカウントに覚える設定(明暗・World・立体の見た目)の、画面側の覚え方と送り方。React・通信・保存先には依存しない
// (通信・保存・クッキーは外から渡す。画面に付けるのは PrefsProvider.tsx、ブラウザの実物は prefs-client.ts)。
//
// 決まり(作業指示 P2b の 6・7 章):
// - タブを開くごとに 1 回だけ読み(load)、この端末の送っていない変更があれば、先に送る(この端末が勝つ)。
//   アカウントに何も保存していなければ、クッキーの明暗を送って移す。保存してあって、クッキーと違えば、クッキーをアカウントに合わせる。
// - 変えたらすぐ画面とクッキーに反映し、そのあと送る。見た目(look)は 800ms まとめて送り、明暗・World はすぐ送る。
//   送る要求は同時に 1 つ。終わったら、その間に変わった最新を送る。隠れたとき・ページを離れるときは、送っていない分を keepalive で送る。
// - 送れなかった分は、ブラウザの localStorage(fourdb.prefs.pending)に残し、次のタブの読み込みで先に送る。
//   アカウントへ保存できない(表がない・DB がない)ときは送らず、「このパソコンにだけ」覚える(同じ場所に残す)。
// - 送り先のアカウントを取り違えない(L-4): 残す変更には、画面を作ったときのアカウントの指紋(owner。サーバーが渡す)を付ける。
//   読み込みのとき、いまの指紋と違う変更は、送らずに捨てる。PUT には毎回その指紋を付け、サーバーが、いまのログインと違えば 409 で断る。
//   409(別のアカウントになった)は、その変更を捨て(残さず)、GET で読み直した設定を画面に出して、このタブはもう送らない。
//   401・403(ログインが切れた・断られた)も、残さず、このタブはもう送らない(画面の値はそのまま)。
import {
  DEFAULT_LOOK,
  DEFAULT_WORLD,
  defaultPrefs,
  isOwnerFingerprint,
  isTheme,
  isWorldId,
  LOOK_KEYS,
  parseLookStrict,
  parsePrefsPatch,
  type Look,
  type Prefs,
  type PrefsPatch,
  type Theme,
  type WorldId,
} from "@/fourdb/core/prefs";

/** 保存の状態。idle = まだ変えていない / saving = 送っている(または送る待ち) / saved = 送れた / error = 送れなかった / local = このパソコンにだけ覚えている */
export type SaveState = "idle" | "saving" | "saved" | "error" | "local";

/**
 * 送った結果。unavailable = アカウントの設定の表がまだ使えない(503 prefs_unavailable)/
 * denied = ログインが切れた・断られた(401・403)。残さず、このタブはもう送らない /
 * owner_mismatch = この画面を開いたときと別のアカウントになっている(409 owner_mismatch)。残さず、GET で読み直し、このタブはもう送らない
 */
export type PutOutcome = "ok" | "unavailable" | "denied" | "owner_mismatch" | "error";

/** GET /api/4db/prefs の中身 */
export type ServerPrefs = { available: boolean; saved: boolean; prefs: Prefs };

/** 画面に出す設定と状態(usePrefs が返すもの) */
export type PrefsSnapshot = {
  theme: Theme | null;
  look: Look;
  world: WorldId;
  /** アカウントへ保存できるか(できないと分かるまでは、DB があれば true) */
  available: boolean;
  saveState: SaveState;
  /** タブの読み込みごとの最初の突き合わせが終わったか(終わるまでの設定は、前に覚えていた値とは限らない) */
  loaded: boolean;
};

/** 見た目をまとめて送るまでの待ち(ミリ秒) */
export const LOOK_DEBOUNCE_MS = 800;
/** 送っていない変更を残す localStorage のキー */
export const PENDING_KEY = "fourdb.prefs.pending";

// ---------- 変更(PrefsPatch)の扱い。どれも新しいオブジェクトを返し、引数を書き換えない ----------

export const isEmptyPatch = (p: PrefsPatch): boolean => p.theme === undefined && p.world === undefined && p.look === undefined;

export const sameLook = (a: Look, b: Look): boolean => LOOK_KEYS.every((k) => a[k] === b[k]);

/** base に next を重ねる(next にある欄が勝つ。undefined の欄は重ねない) */
export function mergePatch(base: PrefsPatch, next: PrefsPatch): PrefsPatch {
  const out: PrefsPatch = {};
  const theme = next.theme !== undefined ? next.theme : base.theme;
  const world = next.world !== undefined ? next.world : base.world;
  const look = next.look !== undefined ? next.look : base.look;
  if (theme !== undefined) out.theme = theme;
  if (world !== undefined) out.world = world;
  if (look !== undefined) out.look = { ...look };
  return out;
}

/** 設定に変更を重ねる */
export function applyPatch(prefs: Prefs, patch: PrefsPatch): Prefs {
  return {
    theme: patch.theme !== undefined ? patch.theme : prefs.theme,
    world: patch.world !== undefined ? patch.world : prefs.world,
    look: { ...(patch.look ?? prefs.look) },
  };
}

/** 送れた分(sent)を、送っていない変更(pending)から外す。送っている間にもっと新しい値に変わった欄は残す */
export function subtractSent(pending: PrefsPatch, sent: PrefsPatch): PrefsPatch {
  const out = mergePatch(pending, {});
  if (sent.theme !== undefined && out.theme === sent.theme) delete out.theme;
  if (sent.world !== undefined && out.world === sent.world) delete out.world;
  if (sent.look !== undefined && out.look && sameLook(out.look, sent.look)) delete out.look;
  return out;
}

/** localStorage に残す「送っていない変更」。owner = 残したときの画面のアカウントの指紋(特定できなかったときは null) */
export type StoredPending = { owner: string | null; patch: PrefsPatch };

/**
 * localStorage の文字から、送っていない変更を読む。読めない・形が違う・空のときは null(落ちない)。
 * 形は { owner, patch } だけ。owner は指紋の形か null、patch は parsePrefsPatch が通すもの。
 * owner のない古い形(変更だけ)は、どのアカウントのものか分からないので読まない(null)。
 */
export function parseStoredPending(text: string | null | undefined): StoredPending | null {
  if (!text) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== 2 || !keys.includes("owner") || !keys.includes("patch")) return null;
    const { owner, patch } = raw as { owner: unknown; patch: unknown };
    if (owner !== null && !isOwnerFingerprint(owner)) return null;
    const parsed = parsePrefsPatch(patch);
    return typeof parsed === "string" ? null : { owner, patch: parsed };
  } catch {
    return null;
  }
}

export type ReconcilePlan = {
  /** 画面に出す設定(アカウントの設定にこの端末の変更を重ねたもの。明暗はクッキーとも合わせる) */
  prefs: Prefs;
  /** これから送る変更(この端末の変更+アカウントへ移す明暗)。アカウントへ保存できないときは、送らずに残す変更 */
  send: PrefsPatch;
};

/**
 * タブの読み込みごとの最初の突き合わせ。server = GET の答え(読めなかったら null)、cookieTheme = いまのクッキーの明暗、
 * pending = この端末の送っていない変更。
 * 1. この端末の変更があれば、それが勝つ(先に送る)。
 * 2. アカウントに何も保存していなければ(saved: false)、クッキーの明暗を使い、アカウントへ送って移す(クッキーが「合わせる」なら送るものはない)。
 * 3. 保存してあれば、明暗はアカウントの値(クッキーと違えば、呼び手がクッキーを合わせる)。
 */
export function reconcile(server: ServerPrefs | null, cookieTheme: Theme | null, pending: PrefsPatch): ReconcilePlan {
  const base = server ? server.prefs : defaultPrefs();
  const send = mergePatch({}, pending);
  let theme = base.theme;
  if (!server || !server.saved) {
    theme = cookieTheme;
    if (server?.available && send.theme === undefined && cookieTheme !== null) send.theme = cookieTheme;
  }
  return { prefs: applyPatch({ ...base, theme }, pending), send };
}

// ---------- 覚える入れ物 ----------

export type StoreDeps = {
  /** GET /api/4db/prefs。失敗したら throw */
  load(signal: AbortSignal): Promise<ServerPrefs>;
  /** PUT /api/4db/prefs。keepalive は、ページを離れるときの送り方。owner は、この画面のアカウントの指紋(毎回付けて送る) */
  put(patch: PrefsPatch, keepalive: boolean, owner: string): Promise<PutOutcome>;
  /** 送っていない変更を localStorage から読む(なければ・読めなければ null)・書く(null で消す)。どちらも落ちない */
  readStored(): StoredPending | null;
  writeStored(stored: StoredPending | null): void;
  /** いまのクッキーの明暗 */
  readCookieTheme(): Theme | null;
  /** クッキーと <html data-theme> を書く(null は「パソコンの設定に合わせる」=クッキーと印を消す) */
  applyTheme(theme: Theme | null): void;
};

export type StoreOptions = {
  /** アカウントへ保存する場所(DB)があるか。false なら通信しない */
  enabled: boolean;
  /** サーバーがクッキーから読んだ明暗(最初の画面と同じにする) */
  initialTheme: Theme | null;
  /**
   * この画面を作ったときのログイン中のアカウントの指紋(サーバーが渡す。メールアドレスも principal も分からない)。
   * 残す変更に付け、読み込みで違うものを捨て、PUT のたびに送る。アカウントを特定できない(null・形が違う)ときは、アカウントへは送らない。
   * 画面を作ってから変えない(GET の答えなどで取り替えない。取り替えると、別のアカウントの画面が、新しいアカウントとして送ってしまう)
   */
  owner: string | null;
  debounceMs?: number;
};

/**
 * 画面に出す設定と、アカウントへの送り方をまとめて持つ。React の useSyncExternalStore に渡せる
 * (subscribe・getSnapshot・getServerSnapshot)。最初の状態は initialTheme と既定の見た目・World で、サーバーと同じ。
 */
export class PrefsStore {
  private readonly deps: StoreDeps;
  private readonly enabled: boolean;
  /** この画面のアカウントの指紋(特定できなければ null) */
  private readonly owner: string | null;
  private readonly debounceMs: number;
  private readonly initial: PrefsSnapshot;
  private snap: PrefsSnapshot;
  private readonly listeners = new Set<() => void>();

  /** まだ「送れた」と分かっていない変更(送っている最中のものも含む) */
  private pending: PrefsPatch = {};
  /** 最初の突き合わせが終わったか(終わるまで送らない) */
  private ready = false;
  /** アカウントへ保存できるか(DB がなければ false。あるうちは、できないと分かるまで true) */
  private availableNow: boolean;
  /** 要求にまだ載せていない変更があるか(失敗して残っている分も含む) */
  private needsSend = false;
  private flying = 0;
  private failed = false;
  private everSaved = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** このタブはもう送らない(401・403・409 のあと。読み込み直すまで戻らない)。残す・送るをしない */
  private halted = false;
  private resyncCtrl: AbortController | null = null;

  constructor(deps: StoreDeps, opts: StoreOptions) {
    this.deps = deps;
    this.owner = isOwnerFingerprint(opts.owner) ? opts.owner : null;
    // アカウントを特定できなければ、アカウントへは送らない(指紋のない PUT はサーバーが 409 で断るので、出さない)
    this.enabled = opts.enabled && this.owner !== null;
    this.debounceMs = opts.debounceMs ?? LOOK_DEBOUNCE_MS;
    this.availableNow = this.enabled;
    this.initial = {
      theme: opts.initialTheme,
      look: { ...DEFAULT_LOOK },
      world: DEFAULT_WORLD,
      available: this.enabled,
      saveState: this.enabled ? "idle" : "local",
      loaded: false,
    };
    this.snap = this.initial;
  }

  // ----- useSyncExternalStore 向け -----

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = (): PrefsSnapshot => this.snap;
  getServerSnapshot = (): PrefsSnapshot => this.initial;

  // ----- 画面からの変更 -----

  setTheme = (next: Theme | null): void => {
    if (next !== null && !isTheme(next)) return;
    this.deps.applyTheme(next);
    if (this.snap.loaded && next === this.snap.theme) return;
    this.set({ theme: next });
    this.change({ theme: next });
  };

  setLook = (next: Look): void => {
    const look = parseLookStrict(next);
    if (typeof look === "string") return;
    if (this.snap.loaded && sameLook(look, this.snap.look)) return;
    this.set({ look });
    this.change({ look });
  };

  setWorld = (next: WorldId): void => {
    if (!isWorldId(next)) return;
    if (this.snap.loaded && next === this.snap.world) return;
    this.set({ world: next });
    this.change({ world: next });
  };

  /** 送れなかった分を、いま送り直す */
  retry = (): void => {
    if (!this.canSend()) return;
    this.send(false);
  };

  /** 送っていない分を、いま送る(隠れたとき・ページを離れるときは keepalive: true) */
  flush = (keepalive = false): void => {
    this.clearTimer();
    if (!this.canSend()) return;
    if (this.needsSend) this.send(keepalive);
    else this.refreshState();
  };

  /**
   * タブを開いたときの突き合わせを始める(1 回の GET)。返す関数で、読み込みをやめ、送っていない分を送る。
   * 開発の StrictMode のように、始める・やめる・始めるが続いても壊れない。
   */
  start = (): (() => void) => {
    const ctrl = new AbortController();
    const stored = this.deps.readStored();
    if (stored !== null) {
      // 同じアカウントの画面が残した変更だけを使う。違うアカウントのものは、送らずに捨てる(前の人の変更を、いまの人のアカウントへ送らない)
      if (stored.owner === this.owner) this.pending = mergePatch(stored.patch, this.pending); // すでにこのタブで変えた分が勝つ
      else this.deps.writeStored(null);
    }
    void this.boot(ctrl.signal);
    return () => {
      ctrl.abort();
      this.resyncCtrl?.abort();
      this.flush(true);
    };
  };

  // ----- 中身 -----

  private canSend(): boolean {
    return this.enabled && this.ready && this.availableNow && !this.halted;
  }

  private async boot(signal: AbortSignal): Promise<void> {
    let server: ServerPrefs | null;
    if (!this.enabled) {
      server = { available: false, saved: false, prefs: defaultPrefs() };
    } else {
      try {
        server = await this.deps.load(signal);
      } catch {
        if (signal.aborted) return;
        server = null; // 読めなかった: 保存できるものとして進め、送ってみて分かったことに従う
      }
      if (signal.aborted) return;
    }
    const cookie = this.deps.readCookieTheme();
    const plan = reconcile(server, cookie, this.pending);
    // 突き合わせた明暗を、クッキーと <html data-theme> の両方に、いつも書く(同じ値を書いても何も変わらない)。
    // クッキーとだけ比べると、クッキーは合っているのに <html data-theme> が違う(最初の画面が古いクッキーで描かれた・別のタブがクッキーを変えた)ときに、画面が合わないまま残る
    this.deps.applyTheme(plan.prefs.theme);
    this.pending = plan.send;
    this.availableNow = this.enabled && (server ? server.available : true);
    this.ready = true;
    this.set({ theme: plan.prefs.theme, look: plan.prefs.look, world: plan.prefs.world, loaded: true });
    if (!this.availableNow) {
      this.needsSend = false;
      if (!isEmptyPatch(this.pending)) this.persist(this.pending); // このパソコンにだけ覚える
      this.refreshState();
      return;
    }
    this.needsSend = !isEmptyPatch(this.pending);
    if (this.needsSend) this.send(false);
    else this.refreshState();
  }

  /** 送っていない変更を、このタブのアカウントの指紋を付けて localStorage に残す(空なら消す) */
  private persist(patch: PrefsPatch): void {
    this.deps.writeStored(isEmptyPatch(patch) ? null : { owner: this.owner, patch: mergePatch({}, patch) });
  }

  private change(patch: PrefsPatch): void {
    if (this.halted) {
      // もう送らない(ログインが切れた・別のアカウントになった)。画面の値だけ変わる。残さない(次にこのブラウザでログインする人に渡さない)
      this.refreshState();
      return;
    }
    this.pending = mergePatch(this.pending, patch);
    this.needsSend = true;
    if (!this.enabled || !this.availableNow) {
      this.needsSend = false;
      this.persist(this.pending);
      this.refreshState();
      return;
    }
    if (this.failed) this.persist(this.pending); // 失敗して残っている分と一緒に残す
    if (this.ready) {
      if (patch.theme !== undefined || patch.world !== undefined) this.send(false);
      else this.schedule();
    }
    this.refreshState();
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.send(false);
    }, this.debounceMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private send(keepalive: boolean): void {
    this.clearTimer();
    const owner = this.owner;
    if (!this.canSend() || owner === null) {
      this.refreshState();
      return;
    }
    if (isEmptyPatch(this.pending)) {
      this.needsSend = false;
      this.refreshState();
      return;
    }
    if (this.flying > 0 && !keepalive) {
      // 要求は同時に 1 つ。終わったら、最新を送る(done の中)
      this.refreshState();
      return;
    }
    const sent = mergePatch({}, this.pending);
    this.needsSend = false;
    this.failed = false;
    this.flying += 1;
    this.refreshState();
    this.deps
      .put(sent, keepalive, owner)
      .catch((): PutOutcome => "error")
      .then((outcome) => this.done(sent, outcome));
  }

  /**
   * このタブはもう送らない。送っていない変更・まとめ待ちは捨て(残さない)、保存先は「このパソコンにだけ」の表示にする。画面の値は変えない。
   * このタブのアカウントが localStorage に残した変更(失敗のあとに change() が残した分)も消す(止めたあとに、同じアカウントで開いた画面が古い変更を送らないように)。
   * ほかのアカウントの画面が残した分(指紋が違う)には触らない
   */
  private halt(): void {
    this.halted = true;
    this.availableNow = false;
    this.needsSend = false;
    this.failed = false;
    this.pending = {};
    this.clearTimer();
    const stored = this.deps.readStored();
    if (stored !== null && stored.owner === this.owner) this.deps.writeStored(null);
  }

  /**
   * 409(別のアカウントになった)のあと、いまのログインの設定を GET で読み直して画面に出す(送らない)。
   * 読めなければ(ログアウトなど)何もしない。クッキーの明暗は、保存があればその値に合わせる(タブの読み込みごとの突き合わせと同じ決まり)
   */
  private async resync(): Promise<void> {
    this.resyncCtrl?.abort();
    const ctrl = new AbortController();
    this.resyncCtrl = ctrl;
    let server: ServerPrefs;
    try {
      server = await this.deps.load(ctrl.signal);
    } catch {
      return;
    }
    if (ctrl.signal.aborted) return;
    const plan = reconcile(server, this.deps.readCookieTheme(), {});
    this.deps.applyTheme(plan.prefs.theme);
    this.set({ theme: plan.prefs.theme, look: plan.prefs.look, world: plan.prefs.world });
  }

  private done(sent: PrefsPatch, outcome: PutOutcome): void {
    this.flying -= 1;
    if (this.halted) {
      // 別の要求の結果ですでに止めている。この結果では何も残さない・送り直さない
      this.refreshState();
      return;
    }
    if (outcome === "ok") {
      this.pending = subtractSent(this.pending, sent);
      this.everSaved = true;
      this.failed = false;
      this.deps.writeStored(null); // 送れた分は残さない。送っている間に変わった分は、これから送る
      this.needsSend = !isEmptyPatch(this.pending);
      if (this.needsSend && this.flying === 0 && this.timer === null) {
        this.send(false);
        return;
      }
    } else if (outcome === "unavailable") {
      this.availableNow = false;
      this.needsSend = false;
      this.persist(this.pending);
    } else if (outcome === "denied") {
      this.halt();
    } else if (outcome === "owner_mismatch") {
      this.halt();
      void this.resync();
    } else {
      this.failed = true;
      this.needsSend = true;
      this.persist(this.pending);
    }
    this.refreshState();
  }

  private computeState(): SaveState {
    if (!this.enabled || !this.availableNow) return "local";
    if (this.flying > 0 || this.timer !== null || (this.needsSend && !this.failed)) return "saving";
    if (this.failed) return "error";
    return this.everSaved ? "saved" : "idle";
  }

  private refreshState(): void {
    this.set({ saveState: this.computeState(), available: this.enabled && this.availableNow });
  }

  private set(next: Partial<PrefsSnapshot>): void {
    const merged: PrefsSnapshot = { ...this.snap, ...next };
    const keys = Object.keys(merged) as (keyof PrefsSnapshot)[];
    if (keys.every((k) => merged[k] === this.snap[k])) return;
    this.snap = merged;
    for (const l of [...this.listeners]) l();
  }
}
