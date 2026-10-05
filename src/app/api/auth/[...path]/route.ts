import { auth } from "@/lib/auth";

// ブラウザからのログイン操作を Neon Auth へ中継する
const notConfigured = async () => Response.json({ error: "ログインの設定がありません" }, { status: 404 });
export const { GET, POST } = auth ? auth.handler() : { GET: notConfigured, POST: notConfigured };
