// RedFox transports X data; the existing fetcher still owns extraction and quality rules.
export function parseXPage(data) {
    if (!data || !Array.isArray(data.tweets)) throw new Error("RedFox X 响应结构未识别；请核对真实样本，不按空结果处理");
    const rows = data.tweets.map(tweet => {
        if (!/^\d+$/.test(String(tweet.tweetId)) || typeof tweet.text !== "string" || !Number.isFinite(Date.parse(tweet.createdAt)) || !tweet.user?.userId || !tweet.user?.username || !Array.isArray(tweet.medias)) throw new Error("RedFox X 条目缺少正文、时间、作者或媒体字段");
        return {
            id_str: String(tweet.tweetId), rawContent: tweet.text, date: tweet.createdAt,
            likeCount: tweet.likeCount ?? null, bookmarkedCount: tweet.bookmarkCount ?? null, retweetCount: tweet.retweetCount ?? null,
            user: { id_str: String(tweet.user.userId), username: tweet.user.username, followersCount: tweet.user.followers ?? null },
            media: {
                photos: tweet.medias.filter(item => item.type === "photo").map(item => ({ url: item.coverUrl })),
                videos: tweet.medias.filter(item => item.type === "video" || item.type === "animated_gif").map(item => ({ thumbnailUrl: item.coverUrl })),
            },
        };
    });
    return { rows, cursor: data.nextCursor || "" };
}

export async function redfoxX(args, timeoutMs, fetcher = fetch, singlePage = false, onSample = () => {}) {
    const key = process.env.REDFOX_API_KEY;
    if (!key) return { code: 1, rows: [], err: "缺少 REDFOX_API_KEY" };
    const search = args[0] === "search";
    const limit = Number(args[args.indexOf("--limit") + 1]);
    const rows = new Map();
    const cursors = new Set();
    let cursor = "";
    const signal = AbortSignal.timeout(timeoutMs);
    try {
        do {
            const body = search ? { keyword: args[1], searchType: "Latest" } : { tweetId: args[1] };
            if (cursor) body.cursor = cursor;
            const response = await fetcher(`https://redfox.hk/story/api/x/${search ? "search" : "tweetComments"}`, {
                method: "POST", headers: { "content-type": "application/json", REDFOX_API_KEY: key },
                body: JSON.stringify(body), signal,
            });
            if (!response.ok) throw new Error(`RedFox HTTP ${response.status}`);
            const result = await response.json();
            if (singlePage) onSample(result);
            if (result.code !== 2000) throw new Error(`RedFox 业务失败 code=${String(result.code)}`);
            const page = parseXPage(result.data);
            const before = rows.size;
            for (const row of page.rows) rows.set(row.id_str, row);
            cursor = page.cursor;
            if (singlePage || rows.size === before || !cursor || cursors.has(cursor)) break;
            cursors.add(cursor);
        } while (rows.size < limit);
        return { code: 0, rows: [...rows.values()].slice(0, limit), err: "" };
    } catch (error) {
        // Partial or malformed paid responses cannot masquerade as a successful source.
        return { code: 1, rows: [], err: error.message };
    }
}
