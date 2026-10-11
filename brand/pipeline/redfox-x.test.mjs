import assert from "node:assert/strict";
import { test } from "node:test";
import { parseXPage, redfoxX } from "./lib/redfox-x.mjs";

const tweet = (id, extra = {}) => ({ tweetId: String(id), text: "完整提示词", createdAt: "Tue Oct 06 11:42:41 +0000 2026", user: { userId: "123", username: "creator", followers: 500 }, medias: [{ type: "photo", coverUrl: "https://pbs.twimg.com/media/sample.jpg" }], ...extra });

test("verified RedFox shape preserves full text, media, identities and unknown metrics", () => {
    const { rows } = parseXPage({ tweets: [tweet(1), tweet(2, { medias: [{ type: "video", coverUrl: "https://pbs.twimg.com/video.jpg" }] })] });
    assert.equal(rows[0].rawContent, "完整提示词");
    assert.equal(rows[0].bookmarkedCount, null);
    assert.equal(rows[0].user.id_str, "123");
    assert.equal(rows[1].media.videos[0].thumbnailUrl, "https://pbs.twimg.com/video.jpg");
    assert.deepEqual(parseXPage({ tweets: [] }).rows, []);
    assert.throws(() => parseXPage({ entries: [tweet(1)] }));
    assert.throws(() => parseXPage({ tweets: [{ tweetId: "1" }] }));
});

test("one-call verification, deduplicated pagination and stagnant cursors stop without extra paid retries", async () => {
    const previous = process.env.REDFOX_API_KEY;
    process.env.REDFOX_API_KEY = "fixture-secret";
    try {
        let calls = 0;
        const fetcher = async (_url, options) => {
            calls++;
            assert.equal(options.headers.REDFOX_API_KEY, "fixture-secret");
            assert.equal(JSON.parse(options.body).keyword, "gpt image prompt");
            return Response.json({ code: 2000, data: { tweets: [tweet(1)], nextCursor: `cursor-${calls}` } });
        };
        const args = ["search", "gpt image prompt", "--limit", "40"];
        assert.equal((await redfoxX(args, 1000, fetcher, true)).rows.length, 1);
        assert.equal(calls, 1);
        calls = 0;
        assert.equal((await redfoxX(args, 1000, fetcher)).rows.length, 1);
        assert.equal(calls, 2);
        const failed = await redfoxX(args, 1000, async () => Response.json({ code: 1002, msg: "fixture-secret" }));
        assert.equal(failed.code, 1);
        assert.equal(failed.rows.length, 0);
        assert.ok(!failed.err.includes("fixture-secret"));
    } finally {
        if (previous === undefined) delete process.env.REDFOX_API_KEY; else process.env.REDFOX_API_KEY = previous;
    }
});

