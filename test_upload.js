// Testes da planilha de upload (apps-script/Code.gs): E.164, SHA-256, Order ID, hora, regra de consentimento,
// dedupe e doPost com stubs. Sem dependências. Rodar: node --test test_upload.js
// Só dados sintéticos; nenhum serviço Google é chamado (SpreadsheetApp/Utilities/etc. são stubs locais).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sha = s => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const FAKE_ID = "TESTE_planilha_upload_sintetica_000";  // não é ID real

/* Folha de planilha em memória: getLastRow/appendRow/getRange(...).getValues/setValues/setNumberFormat/deleteRow. */
function fakeSheet(rows = []) {
  const sh = {
    rows, frozen: 0,
    getLastRow: () => sh.rows.length,
    appendRow: r => { sh.rows.push(r.slice()); },
    setFrozenRows: n => { sh.frozen = n; },
    deleteRow: n => { sh.rows.splice(n - 1, 1); },
    getRange: (r, c, nr, nc) => ({
      getValues: () => sh.rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)),
      setNumberFormat() { return this; },
      setValues: vals => vals.forEach((v, k) => { sh.rows[r - 1 + k] = v.slice(); }),
    }),
  };
  return sh;
}

/* Carrega o Code.gs real num sandbox. Utilities.computeDigest imita o Apps Script: bytes COM sinal (-128..127). */
function loadGs({ uploadId = FAKE_ID, upload = fakeSheet(), openThrows = false } = {}) {
  const calls = { leads: [], sendEmail: [], openById: [], warn: [] };
  const leads = { getLastRow: () => 1, appendRow: r => calls.leads.push(r), setFrozenRows() {} };
  const sandbox = {
    console: { log() {}, error() {}, warn: m => calls.warn.push(String(m)) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === "UPLOAD_SHEET_ID" ? uploadId : null) }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => leads, insertSheet: () => leads, getUrl: () => "https://example.invalid/planilha" }),
      openById: id => { calls.openById.push(id); if (openThrows) throw new Error("sem acesso"); return { getSheets: () => [upload] }; },
    },
    MailApp: { sendEmail: m => calls.sendEmail.push(m) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: (alg, s) => Array.from(crypto.createHash("sha256").update(s, "utf8").digest()).map(b => (b > 127 ? b - 256 : b)),
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "apps-script", "Code.gs"), "utf8"), sandbox, { filename: "Code.gs" });
  return { gs: sandbox, calls, upload };
}

function post(extra) {
  const p = { nome: "Teste Sintético", clinica: "Clínica Teste", especialidade: "Teste", whatsapp: "11912345678",
    nota_geral: 50, faixa: "Teste", nota_atendimento: 50, nota_equipe: 50, nota_processos: 50, nota_financeiro: 50, nota_crescimento: 50,
    ...extra };
  for (let i = 1; i <= 15; i++) p["q" + i] = "A";
  return { postData: { contents: JSON.stringify(p) } };
}

test("toE164Br_ usa a normalização v2", () => {
  const { gs } = loadGs();
  assert.equal(gs.toE164Br_("11912345678"), "+5511912345678");
  assert.equal(gs.toE164Br_("+55 (11) 91234-5678"), "+5511912345678");
  assert.equal(gs.toE164Br_("55987654321"), "+5555987654321");  // DDD 55
  assert.equal(gs.toE164Br_("1133334444"), "");                 // fixo
  assert.equal(gs.toE164Br_(""), "");
});

test("sha256Hex_ converte bytes com sinal em hex minúsculo", () => {
  const { gs } = loadGs();
  assert.equal(gs.sha256Hex_("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(gs.sha256Hex_("+5511912345678"), sha("+5511912345678"));
  assert.match(gs.sha256Hex_("+5511912345678"), /^[0-9a-f]{64}$/);
});

test("orderId_ é 'diag-' + SHA-256 hex de recebido_em + E.164, estável", () => {
  const { gs } = loadGs();
  const id = gs.orderId_("2026-11-16T12:00:00.000Z", "+5511912345678");
  assert.equal(id, "diag-" + sha("2026-11-16T12:00:00.000Z+5511912345678"));
  assert.equal(id, gs.orderId_("2026-11-16T12:00:00.000Z", "+5511912345678"));
  assert.notEqual(id, gs.orderId_("2026-11-16T12:00:01.000Z", "+5511912345678"));
  assert.ok(!id.includes("11912345678"));
});

test("conversionTime_ converte ISO UTC para America/Sao_Paulo (-03:00)", () => {
  const { gs } = loadGs();
  assert.equal(gs.conversionTime_("2026-11-16T12:34:56.789Z"), "2026-11-16 09:34:56-03:00");
  assert.equal(gs.conversionTime_("2026-01-01T01:02:03.000Z"), "2025-12-31 22:02:03-03:00");  // vira o ano
  assert.equal(gs.conversionTime_("2026-03-01T02:00:00.000Z"), "2026-02-28 23:00:00-03:00");
  assert.equal(gs.conversionTime_("lixo"), "");
});

test("shouldUpload_: só com consentimento true e (clique ou telefone)", () => {
  const { gs } = loadGs();
  assert.equal(gs.shouldUpload_(true, { gclid: "TESTgclid" }, ""), true);
  assert.equal(gs.shouldUpload_(true, {}, "+5511912345678"), true);
  assert.equal(gs.shouldUpload_(true, { gbraid: "x" }, ""), true);
  assert.equal(gs.shouldUpload_(true, {}, ""), false);
  assert.equal(gs.shouldUpload_(false, { gclid: "TESTgclid" }, "+5511912345678"), false);
  assert.equal(gs.shouldUpload_("true", { gclid: "TESTgclid" }, "+5511912345678"), false);  // só booleano true
  assert.equal(gs.shouldUpload_(undefined, { gclid: "TESTgclid" }, "+5511912345678"), false);
});

test("cleanClickId_ aceita só [A-Za-z0-9_-]", () => {
  const { gs } = loadGs();
  assert.equal(gs.cleanClickId_(" TEST-gclid_123 "), "TEST-gclid_123");
  assert.equal(gs.cleanClickId_("=HYPERLINK(1)"), "");
  assert.equal(gs.cleanClickId_(null), "");
  assert.equal(gs.cleanClickId_("a".repeat(201)), "");
});

test("buildUploadRow_ monta a linha minimizada sem PII em claro", () => {
  const { gs } = loadGs();
  const lead = { whatsapp: "11912345678", consentimento: true, recebido_em: "2026-11-16T12:00:00.000Z", nome: "Teste Sintético", clinica: "Clínica Teste" };
  const row = gs.buildUploadRow_(lead, { gclid: "TESTgclid123", gbraid: "", wbraid: "" });
  assert.deepEqual(Array.from(gs.UPLOAD_HEADERS), ["Google Click ID", "gbraid", "wbraid", "Conversion Name", "Conversion Time",
    "Conversion Value", "Conversion Currency", "Order ID", "Phone"]);
  assert.deepEqual(Array.from(row), ["TESTgclid123", "", "", "Lead diagnóstico (importação)", "2026-11-16 09:00:00-03:00", 1, "BRL",
    "diag-" + sha("2026-11-16T12:00:00.000Z+5511912345678"), sha("+5511912345678")]);
  const flat = JSON.stringify(row);
  for (const pii of ["11912345678", "Teste Sintético", "Clínica Teste"]) assert.ok(!flat.includes(pii), pii);
  assert.equal(gs.buildUploadRow_({ ...lead, consentimento: false }, { gclid: "TESTgclid123" }), null);
});

test("uploadRowsToRemove_ deduplica por Order ID e tira linhas vazias", () => {
  const { gs } = loadGs();
  const r = (oid, gclid = "g", phone = "h") => [gclid, "", "", "n", "t", 1, "BRL", oid, phone];
  assert.deepEqual(Array.from(gs.uploadRowsToRemove_([r("a"), r("b"), r("a"), r(""), r("c", "", ""), r("b")])), [2, 3, 4, 5]);
});

test("doPost sem consentimento: grava em Leads com false, não toca a planilha de upload", () => {
  const { gs, calls, upload } = loadGs();
  assert.deepEqual(gs.doPost(post({ consentimento: false, gclid: "TESTgclid123" })), { status: "ok" });
  assert.equal(calls.leads.length, 1);
  assert.equal(calls.leads[0][gs.FIELDS.indexOf("consentimento")], false);
  assert.equal(calls.leads[0].length, gs.FIELDS.length);  // aba Leads sem colunas novas
  assert.equal(upload.rows.length, 0);
  assert.equal(calls.openById.length, 0);
  assert.equal(calls.sendEmail.length, 1);
});

test("doPost sem o campo consentimento também grava (false) e não sobe", () => {
  const { gs, calls, upload } = loadGs();
  assert.deepEqual(gs.doPost(post({})), { status: "ok" });
  assert.equal(calls.leads[0][gs.FIELDS.indexOf("consentimento")], false);
  assert.equal(upload.rows.length, 0);
});

test("doPost com consentimento + gclid: grava Leads (true) e 1 linha de upload com cabeçalho, sem repetir", () => {
  const upload = fakeSheet();
  const { gs, calls } = loadGs({ upload });
  assert.deepEqual(gs.doPost(post({ consentimento: true, gclid: "TESTgclid123" })), { status: "ok" });
  assert.equal(calls.leads[0][gs.FIELDS.indexOf("consentimento")], true);
  assert.deepEqual(calls.openById, [FAKE_ID]);
  assert.deepEqual(Array.from(upload.rows[0]), Array.from(gs.UPLOAD_HEADERS));
  assert.equal(upload.rows.length, 2);
  const line = upload.rows[1], recebido = calls.leads[0][gs.FIELDS.indexOf("recebido_em")];
  assert.equal(line[0], "TESTgclid123");
  assert.equal(line[7], "diag-" + sha(recebido + "+5511912345678"));
  assert.equal(line[8], sha("+5511912345678"));
  assert.ok(!JSON.stringify(upload.rows).includes("11912345678"));
  // Mesmo lead de novo (mesmo recebido_em + telefone) não duplica
  const lead = { whatsapp: "11912345678", consentimento: true, recebido_em: recebido };
  assert.equal(gs.writeUpload_(lead, { gclid: "TESTgclid123" }), "duplicate");
  assert.equal(upload.rows.length, 2);
});

test("doPost com consentimento sem clique (ex. Instagram) sobe só o telefone hasheado", () => {
  const { gs, upload } = loadGs();
  gs.doPost(post({ consentimento: true, origem: "instagram" }));
  assert.equal(upload.rows.length, 2);
  assert.deepEqual(Array.from(upload.rows[1].slice(0, 3)), ["", "", ""]);
  assert.equal(upload.rows[1][8], sha("+5511912345678"));
});

test("doPost sem UPLOAD_SHEET_ID (ou com ID inválido ou sem acesso) grava o lead e responde ok", () => {
  for (const opts of [{ uploadId: null }, { uploadId: "curto" }, { openThrows: true }]) {
    const { gs, calls, upload } = loadGs(opts);
    assert.deepEqual(gs.doPost(post({ consentimento: true, gclid: "TESTgclid123" })), { status: "ok" }, JSON.stringify(opts));
    assert.equal(calls.leads.length, 1);
    assert.equal(upload.rows.length, 0);
    assert.equal(calls.sendEmail.length, 1);
  }
});

test("reconcileUploadSheet remove Order ID repetido mantendo cabeçalho e 1ª linha", () => {
  const { gs, upload } = loadGs();
  const r = (oid, g) => [g, "", "", "Lead diagnóstico (importação)", "2026-11-16 09:00:00-03:00", 1, "BRL", oid, "h"];
  upload.rows.push(Array.from(gs.UPLOAD_HEADERS), r("diag-a", "g1"), r("diag-b", "g2"), r("diag-a", "g3"));
  assert.equal(gs.reconcileUploadSheet(), 1);
  assert.deepEqual(upload.rows.map(x => x[0]), ["Google Click ID", "g1", "g2"]);
  assert.equal(gs.reconcileUploadSheet(), 0);
});

/* app.js: captura de atribuição (sessionStorage em memória). */
test("app.js captureAttribution: URL primeiro, depois o guardado; cliques não se misturam", () => {
  const module = { exports: {} }, el = { innerHTML: "", focus() {}, querySelector: () => el, querySelectorAll: () => [] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), {
    module, console, URLSearchParams, window: { scrollTo() {} }, document: { querySelector: () => el, referrer: "" },
    location: { search: "", hostname: "test" }, fetch: () => new Promise(() => {}),
  }, { filename: "app.js" });
  const { captureAttribution } = module.exports, mem = {};
  const store = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  let a = captureAttribution("?gclid=TESTg1&utm_source=google&src=ads", store);
  assert.equal(a.gclid, "TESTg1"); assert.equal(a.utm_source, "google"); assert.equal(a.src, "ads");
  a = captureAttribution("", store);                         // volta sem parâmetros: reaproveita
  assert.equal(a.gclid, "TESTg1"); assert.equal(a.utm_source, "google");
  a = captureAttribution("?gbraid=TESTb2", store);           // novo clique: troca os 3 identificadores juntos
  assert.equal(a.gclid, ""); assert.equal(a.gbraid, "TESTb2"); assert.equal(a.utm_source, "google");
  assert.equal(JSON.parse(mem.nv_attr).gbraid, "TESTb2");
});
