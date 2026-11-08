"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const file = path.join(__dirname, "apps-script", "Code.gs");
const src = fs.readFileSync(file, "utf8");
const sandbox = { console, Object, Math, String, Number };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: file });

const ORIGINAL = [
  "timestamp", "nome", "clinica", "especialidade", "whatsapp", "consentimento",
  "q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11", "q12", "q13", "q14", "q15",
  "nota_geral", "faixa", "nota_atendimento", "nota_equipe", "nota_processos", "nota_financeiro", "nota_crescimento",
  "utm_source", "utm_campaign", "utm_medium", "utm_content", "origem", "referrer", "recebido_em",
];
const STATUS = ["wa_idempotency_key", "wa_disposition", "wa_attempt", "wa_reason", "wa_provider"];
const PLAN_KEYS = ["action", "attempt", "disposition", "leadKey", "provider", "reason", "retryable"];

function keysOf(obj) {
  return Object.keys(obj).sort();
}
function local(v) {
  return JSON.parse(JSON.stringify(v));
}
function sha(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}
function plan(over) {
  return sandbox.planWhatsAppHandoff(Object.assign({
    consent: true,
    leadKey: sandbox.leadKeyFor("2026-01-01T00:00:00.000Z", "11987654321"),
    seenKeys: [],
    providerName: "",
  }, over));
}

const fields = local(sandbox.FIELDS);
assert.deepStrictEqual(fields.slice(0, ORIGINAL.length), ORIGINAL);
assert.deepStrictEqual(fields.slice(ORIGINAL.length), STATUS);
assert.strictEqual(sandbox.FIELDS.indexOf("recebido_em"), ORIGINAL.length - 1);

["", "abc", "áé", "2026-01-01T00:00:00.000Z|11987654321", "x".repeat(1000), "🙂"].forEach((sample) => {
  assert.strictEqual(sandbox.sha256Hex(sample), sha(sample), "sha256 " + JSON.stringify(sample));
});

const key = sandbox.leadKeyFor("2026-01-01T00:00:00.000Z", "(11) 98765-4321");
assert.strictEqual(key, sha("2026-01-01T00:00:00.000Z|11987654321"));
assert.notStrictEqual(
  sandbox.leadKeyFor("2026-01-01T00:00:00.000Z", "11987654321"),
  sandbox.leadKeyFor("2026-01-01T00:00:01.000Z", "11987654321")
);
assert.strictEqual(sandbox.leadKeyFor("", "11987654321"), "");
assert.strictEqual(sandbox.leadKeyMaterial("2026-01-01T00:00:00.000Z", "11 98765-4321"), "2026-01-01T00:00:00.000Z|11987654321");
assert.strictEqual(sandbox.normalizeLeadKey("11987654321"), "");
assert.strictEqual(sandbox.normalizeLeadKey(sha("")), sha(""));

const unconfigured = plan();
assert.deepStrictEqual(keysOf(local(unconfigured)), PLAN_KEYS);
assert.strictEqual(unconfigured.disposition, "provider_unconfigured");
assert.strictEqual(unconfigured.attempt, 0);
assert.strictEqual(unconfigured.retryable, false);
assert.strictEqual(unconfigured.reason, "no_provider");
assert.strictEqual(unconfigured.provider, "none");
assert.deepStrictEqual(local(sandbox.leadWriteDecision(unconfigured)), { write: true, email: true });

const blocked = plan({ consent: false });
assert.strictEqual(blocked.disposition, "blocked_no_consent");
assert.strictEqual(blocked.attempt, 0);
assert.deepStrictEqual(local(sandbox.leadWriteDecision(blocked)), { write: false, email: false });

const again = plan({ seenKeys: ["", key] });
assert.strictEqual(again.disposition, "duplicate");
assert.strictEqual(again.attempt, 0);
assert.strictEqual(again.retryable, false);
assert.deepStrictEqual(local(sandbox.leadWriteDecision(again)), { write: false, email: false });

const noKey = plan({ leadKey: "", seenKeys: [sha("")] });
assert.strictEqual(noKey.disposition, "provider_unconfigured");
assert.notStrictEqual(noKey.disposition, "duplicate");

const secret = "super-secret-token-value";
const rejected = plan({ providerName: "  " + secret + "  " });
assert.strictEqual(rejected.disposition, "provider_rejected");
assert.strictEqual(rejected.reason, "unknown_provider");
assert.strictEqual(rejected.provider, "unrecognized");
assert.strictEqual(rejected.attempt, 0);
assert.strictEqual(rejected.retryable, false);
assert.ok(!JSON.stringify(rejected).includes(secret));
assert.deepStrictEqual(local(sandbox.leadWriteDecision(rejected)), { write: true, email: true });

const mockNamed = plan({ providerName: "mock" });
assert.strictEqual(mockNamed.disposition, "provider_rejected");
assert.ok(!/sent|accepted|delivered/.test(mockNamed.disposition));

["accepted", "sent", "delivered"].forEach((outcome) => {
  const receipt = {
    outcome,
    retryable: true,
    to: "5511987654321",
    body: "texto do quiz",
    messageId: "wamid.FAKE",
    secret: secret,
  };
  const classified = sandbox.classifyProviderReceipt(receipt);
  assert.deepStrictEqual(keysOf(local(classified)), PLAN_KEYS);
  assert.strictEqual(classified.disposition, outcome);
  assert.strictEqual(classified.attempt, 1);
  assert.strictEqual(classified.retryable, false);
  assert.strictEqual(classified.provider, "mock");
  const dumped = JSON.stringify(classified);
  assert.ok(!dumped.includes("5511987654321"));
  assert.ok(!dumped.includes("texto do quiz"));
  assert.ok(!dumped.includes("wamid.FAKE"));
  assert.ok(!dumped.includes(secret));
});

const failed = sandbox.classifyProviderReceipt({ outcome: "failed", retryable: true, messageId: "nope" });
assert.strictEqual(failed.disposition, "failed");
assert.strictEqual(failed.attempt, 1);
assert.strictEqual(failed.retryable, true);
assert.strictEqual(failed.reason, "provider_failed");
assert.strictEqual(sandbox.classifyProviderReceipt({ outcome: "failed", retryable: false }).retryable, false);
assert.strictEqual(sandbox.classifyProviderReceipt(null).reason, "unrecognized_receipt");
assert.strictEqual(sandbox.classifyProviderReceipt({ outcome: "queued" }).disposition, "failed");
assert.deepStrictEqual(local(sandbox.leadWriteDecision(failed)), { write: true, email: true });

const poisonedKey = "11987654321";
const cols = sandbox.whatsAppColumns({
  disposition: poisonedKey,
  attempt: 9,
  reason: secret,
  leadKey: poisonedKey,
  provider: secret,
});
assert.strictEqual(cols.wa_disposition, "provider_unconfigured");
assert.strictEqual(cols.wa_attempt, 0);
assert.strictEqual(sandbox.whatsAppColumns({ disposition: "failed", attempt: 3, reason: "provider_failed", provider: "mock" }).wa_attempt, 3);
assert.strictEqual(sandbox.whatsAppColumns({ disposition: "failed", attempt: 4, reason: "provider_failed", provider: "mock" }).wa_attempt, 0);
assert.strictEqual(cols.wa_reason, "");
assert.strictEqual(cols.wa_idempotency_key, "");
assert.strictEqual(cols.wa_provider, "none");
assert.ok(!JSON.stringify(cols).includes(poisonedKey));
assert.ok(!JSON.stringify(cols).includes(secret));

const row = {
  nome: "Ana Teste",
  clinica: "Clinica Sintetica",
  whatsapp: "11987654321",
  q1: "A",
  nota_geral: 75,
  wa_disposition: "sent",
  wa_message_id: "wamid.FAKE",
  website: "",
};
const cells = sandbox.appendCells(row, unconfigured);
assert.strictEqual(cells.length, sandbox.FIELDS.length);
assert.strictEqual(cells[sandbox.FIELDS.indexOf("nome")], "Ana Teste");
assert.strictEqual(cells[sandbox.FIELDS.indexOf("q1")], "A");
assert.strictEqual(cells[sandbox.FIELDS.indexOf("whatsapp")], "11987654321");
assert.strictEqual(cells[sandbox.FIELDS.indexOf("wa_disposition")], "provider_unconfigured");
assert.strictEqual(cells[sandbox.FIELDS.indexOf("wa_attempt")], 0);
assert.strictEqual(cells[sandbox.FIELDS.indexOf("wa_idempotency_key")], key);
assert.strictEqual(cells.indexOf("wamid.FAKE"), -1);
assert.strictEqual(cells.indexOf("sent"), -1);

const fills = local(sandbox.headerFillPlan(ORIGINAL.concat(["nota do operador"]), sandbox.FIELDS));
assert.deepStrictEqual(fills.map((f) => f.value), STATUS.slice(1));
assert.ok(fills.every((f) => f.col > ORIGINAL.length));
assert.deepStrictEqual(local(sandbox.headerFillPlan(sandbox.FIELDS, sandbox.FIELDS)), []);
assert.strictEqual(sandbox.sheetDataRows_(1), 0);
assert.strictEqual(sandbox.sheetDataRows_(4), 3);

const alert = sandbox.whatsAppAlertLine(rejected);
assert.strictEqual(alert, "WhatsApp automatico: provider_rejected attempt=0 provider=unrecognized reason=unknown_provider");
assert.ok(!alert.includes(secret));
assert.ok(!alert.includes(key));
assert.ok(!alert.includes("@"));

const doPost = src.slice(src.indexOf("function doPost"), src.indexOf("function doGet"));
assert.ok(doPost.includes("planWhatsAppHandoff({"));
assert.ok(doPost.includes("leadWriteDecision(plan)"));
assert.ok(doPost.includes("appendCells(row, plan)"));
assert.ok(doPost.includes("whatsAppAlertLine(plan)"));
const call = doPost.match(/planWhatsAppHandoff\(\{[\s\S]*?\}\)/);
assert.ok(call, "plan call");
assert.ok(!/mockReceipt|postData|row\.|d\[/.test(call[0]));
assert.ok(!doPost.includes("classifyProviderReceipt"));
["UrlFetchApp", "graph.facebook", "api.whatsapp", "twilio", "fetch("].forEach((token) => {
  assert.strictEqual(src.includes(token), false, token);
});
assert.strictEqual(doPost.includes("mockReceipt"), false);
assert.ok(!doPost.includes("console.error(err)"));
assert.ok(doPost.includes("notify_email_failed:"));
assert.ok(doPost.includes("lead_post_failed:"));
assert.ok(doPost.indexOf("appendCells(row, plan)") < doPost.indexOf("MailApp.sendEmail"));

console.log("test_whatsapp_handoff: ok");
