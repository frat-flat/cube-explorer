// URL の中の id の形を確かめる(形の違う値をデータベースに渡さない)
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const notFound = () => Response.json({ error: "見つかりません" }, { status: 404 });
