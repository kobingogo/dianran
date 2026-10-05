import { test } from "node:test";
import assert from "node:assert/strict";
import { promptKey } from "./lib/common.mjs";

test("Chinese prompts retain distinct content identities", () => {
    assert.notEqual(promptKey("水墨远山"), promptKey("汽车发动机"));
    assert.equal(promptKey("水墨，远山！"), promptKey("水墨远山"));
    assert.equal(promptKey("A Cat!"), promptKey("a cat"));
});

test("prompts sharing a long prefix remain distinct", () => {
    const prefix = "cinematic landscape ".repeat(20);
    assert.notEqual(promptKey(prefix + "cat"), promptKey(prefix + "dog"));
});
