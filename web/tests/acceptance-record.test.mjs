import test from "node:test";
import assert from "node:assert/strict";
import { redactAcceptanceRecord } from "../../scripts/acceptance/redact-record.mjs";
test("acceptance record excludes prompts, keys, URLs, bodies and raw Agent/task identities", () => {
    const input = {mode:"video", state:"unknown", baseUrl:"https://user:pass@provider.example/v1?key=secret",model:"test-model",taskId:"private-task-id",threadId:"private-thread",channelId:"channel-identity",postCount:1,queryCount:2,referenceCount:1,headers:{Authorization:"Bearer secret"},prompt:"private-prompt",files:["private-file"],body:{key:"secret"},response:{url:"https://cdn.example/private"},parameters:{size:"1280x720",apiKey:"secret",prompt:"private-prompt"}};
    const record=redactAcceptanceRecord(input), text=JSON.stringify(record);
    for(const secret of ["secret","private-prompt","private-file","private-task-id","private-thread","user:pass","cdn.example"])assert.ok(!text.includes(secret));
    assert.equal(record.environment.channelOrigin,"https://provider.example");assert.equal(record.observations.postCount,1);assert.equal(record.parameters.size,"1280x720");
    assert.equal(record.identities.taskId,redactAcceptanceRecord(input).identities.taskId);assert.equal(record.state,"unknown");
});
test("acceptance utility never upgrades missing or fabricated states to a passing result", () => {
    assert.equal(redactAcceptanceRecord({mode:"image",state:"passed-by-assumption"}).state,"not-run");
    assert.throws(()=>redactAcceptanceRecord({mode:"everything"}),/验收模式/);
});
