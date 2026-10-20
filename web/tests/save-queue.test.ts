import { expect, test } from "bun:test";
import { createSaveQueue } from "../src/lib/canvas/save-queue";

test("a failed write retains the latest snapshot for explicit retry", async () => {
    let fail = true;
    const written: string[] = [];
    const statuses: string[] = [];
    const queue = createSaveQueue(
        async (value) => {
            if (fail) throw new Error("QuotaExceededError");
            written.push(value);
        },
        (status) => statuses.push(status),
    );
    queue.enqueue("original");
    await expect(queue.flush()).rejects.toThrow("QuotaExceededError");
    expect(queue.hasPending()).toBe(true);
    expect(statuses.at(-1)).toBe("error");
    queue.enqueue("latest");
    fail = false;
    await queue.flush();
    expect(written).toEqual(["latest"]);
    expect(statuses.at(-1)).toBe("saved");
    expect(queue.hasPending()).toBe(false);
});

test("new changes during an in-flight write cannot be overwritten by the old snapshot", async () => {
    let finish!: () => void;
    const written: string[] = [];
    const statuses: string[] = [];
    const queue = createSaveQueue(
        async (value) => {
            if (value === "old")
                await new Promise<void>((resolve) => {
                    finish = resolve;
                });
            written.push(value);
        },
        (status) => statuses.push(status),
    );
    queue.enqueue("old");
    const saving = queue.flush();
    queue.enqueue("new");
    expect(statuses.at(-1)).toBe("saving");
    finish();
    await saving;
    expect(written).toEqual(["old", "new"]);
    expect(statuses.at(-1)).toBe("saved");
});
