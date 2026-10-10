import { test } from "node:test";
import assert from "node:assert/strict";
import { createWriteOwnership } from "../src/lib/write-ownership.ts";

globalThis.requestAnimationFrame = ((fn: FrameRequestCallback) => { queueMicrotask(() => fn(0)); return 0; }) as typeof requestAnimationFrame;
function lockFixture() {
    let held = false;
    return { request: async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
        if (held) return callback(null);
        held = true;
        try { return await callback({}); } finally { held = false; }
    } } as unknown as Pick<LockManager, "request">;
}
const settled = async () => { await Promise.resolve(); await Promise.resolve(); };

test("same-origin pages share one writer regardless of project; read-only cannot mutate or generate", async () => {
    const locks = lockFixture(), a = createWriteOwnership(locks), b = createWriteOwnership(locks);
    await a.acquire(async () => {});
    await b.acquire(async () => {});
    assert.equal(a.getSnapshot(), "writer");
    assert.equal(b.getSnapshot(), "readonly");
    let calls = 0;
    await assert.rejects(b.operation(async () => { calls++; })(), /只读/);
    assert.throws(() => b.track(async () => { calls++; }), /编辑权/);
    assert.equal(calls, 0);
    await a.relinquish(async () => {});
    await settled();
});

test("handoff rereads authoritative state before editing; stale page never publishes its old collection", async () => {
    const locks = lockFixture(), a = createWriteOwnership(locks), b = createWriteOwnership(locks);
    let disk = ["old"], bMemory = [...disk];
    await a.acquire(async () => {});
    await b.acquire(async () => { bMemory = [...disk]; });
    disk = ["latest", "different project"];
    await a.relinquish(async () => {}); await settled();
    let finish!: () => void;
    const pending = b.acquire(async () => { await new Promise<void>((resolve) => { finish = resolve; }); bMemory = [...disk]; });
    assert.equal(b.getSnapshot(), "preparing");
    assert.throws(b.assertWriter, /只读/);
    finish(); await pending;
    assert.deepEqual(bMemory, disk);
    await b.relinquish(async () => {}); await settled();
});

test("failed save keeps writer, blocks takeover, and successful retry releases only after receipt", async () => {
    const locks = lockFixture(), a = createWriteOwnership(locks), b = createWriteOwnership(locks);
    await a.acquire(async () => {});
    await assert.rejects(a.relinquish(async () => { throw new Error("disk full"); }), /disk full/);
    assert.equal(a.getSnapshot(), "writer");
    await b.acquire(async () => {}); assert.equal(b.getSnapshot(), "readonly");
    let finish!: () => void;
    const save = a.relinquish(() => new Promise<void>((resolve) => { finish = resolve; }));
    await settled();
    await b.acquire(async () => {}); assert.equal(b.getSnapshot(), "readonly");
    finish(); await save; await settled();
    await b.acquire(async () => {}); assert.equal(b.getSnapshot(), "writer");
    await b.relinquish(async () => {}); await settled();
});

test("upload/generation in flight prevents handoff; no lease or forced takeover", async () => {
    const locks = lockFixture(), a = createWriteOwnership(locks);
    await a.acquire(async () => {});
    let finish!: () => void;
    const upload = a.operation(() => new Promise<void>((resolve) => { finish = resolve; }))();
    await settled();
    await assert.rejects(a.relinquish(async () => {}), /正在执行/);
    assert.equal(a.getSnapshot(), "writer");
    finish(); await upload;
    await a.relinquish(async () => {}); await settled();
});

test("without Web Locks, local editing stays enabled; hydration failure still blocks it", async () => {
    const noLocks = createWriteOwnership(); let hydrated = false;
    await noLocks.acquire(async () => { hydrated = true; });
    assert.equal(noLocks.getSnapshot(), "writer");
    assert.equal(hydrated, true);
    const locks = lockFixture(), a = createWriteOwnership(locks), b = createWriteOwnership(locks);
    await assert.rejects(a.acquire(async () => { throw new Error("corrupt state"); }), /corrupt state/);
    assert.equal(a.getSnapshot(), "readonly");
    await b.acquire(async () => {}); assert.equal(b.getSnapshot(), "writer");
    await b.relinquish(async () => {}); await settled();
});

test("lock API rejection is explicit protected read-only rather than a stuck loading page", async () => {
    const blocked = createWriteOwnership({ request: async () => { throw new Error("SecurityError"); } } as unknown as Pick<LockManager, "request">);
    await assert.rejects(blocked.acquire(async () => {}), /SecurityError/);
    assert.equal(blocked.getSnapshot(), "unsupported");
    assert.match(blocked.getError(), /无法建立编辑保护/);
    assert.throws(blocked.assertWriter, /只读/);
});

test("handoff captures the final editor snapshot while still writer and flushes before releasing", async () => {
    const ownership = createWriteOwnership(lockFixture());
    await ownership.acquire(async () => {});
    let snapshot = "old", saved = "old";
    ownership.beforeRelease(() => { ownership.assertWriter(); snapshot = "latest viewport"; });
    await ownership.relinquish(async () => { assert.equal(ownership.getSnapshot(), "draining"); saved = snapshot; });
    await settled();
    assert.equal(saved, "latest viewport");
    assert.equal(ownership.getSnapshot(), "readonly");
});
