// Testes da validação de WhatsApp (app.js + apps-script/Code.gs). Sem dependências.
// Rodar: node --test test_whatsapp.js
// Só números sintéticos; nada de rede, planilha ou e-mail reais (serviços do Apps Script são stubs).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/* app.js é script de navegador: roda num sandbox com window/document mínimos e lê module.exports. */
function loadApp() {
  const module = { exports: {} };
  const el = { innerHTML: "", focus() {}, querySelector: () => el, querySelectorAll: () => [] };
  const sandbox = {
    module, console, URLSearchParams,
    window: { scrollTo() {} },
    document: { querySelector: () => el, referrer: "" },
    location: { search: "", hostname: "test" },
    fetch: () => new Promise(() => {}),  // init() fica pendente; nada é carregado
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), sandbox, { filename: "app.js" });
  return module.exports;
}

/* Code.gs com stubs de ContentService/LockService/SpreadsheetApp/MailApp que só registram chamadas. */
function loadGs() {
  const calls = { appendRow: [], sendEmail: [] };
  const sheet = { getLastRow: () => 1, appendRow: r => calls.appendRow.push(r), setFrozenRows() {} };
  const sandbox = {
    console,
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet, getUrl: () => "https://example.invalid/planilha" }) },
    MailApp: { sendEmail: m => calls.sendEmail.push(m) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },  // sem planilha de upload
    Utilities: { DigestAlgorithm: {}, Charset: {}, computeDigest: () => [] },        // hash coberto em test_upload.js
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "apps-script", "Code.gs"), "utf8"), sandbox, { filename: "Code.gs" });
  return { gs: sandbox, calls };
}

const app = loadApp();
const { gs } = loadGs();
const impls = [
  ["app.js", app.normalizeBrPhone, app.isValidBrMobile],
  ["Code.gs", gs.normalizeBrPhone_, gs.isValidBrMobile_],
];

// [entrada, normalizado esperado, válido?]
const CASES = [
  ["+55 11 98765-4321", "11987654321", true],
  ["5511987654321", "11987654321", true],
  ["55 11987654321", "11987654321", true],
  ["+5511948818000", "11948818000", true],
  ["11987654321", "11987654321", true],
  ["(11) 98765-4321", "11987654321", true],
  ["55987654321", "55987654321", true],      // DDD 55: não tira o 55
  ["+55 55 98765-4321", "55987654321", true], // +55 com DDD 55
  ["1133334444", "1133334444", false],        // fixo 10 dígitos
  ["551133334444", "1133334444", false],      // +55 + fixo
  ["11187654321", "11187654321", false],      // sem o 9
  ["119876543", "119876543", false],          // curto
  ["119876543210", "119876543210", false],    // longo
  ["+1 415 555 1234", "14155551234", false],  // estrangeiro: 3º dígito não é 9
  ["", "", false],
  [null, "", false],
  [undefined, "", false],
];

for (const [name, normalize, isValid] of impls) {
  test(`${name}: normaliza e valida celular BR`, () => {
    for (const [input, norm, ok] of CASES) {
      assert.equal(normalize(input), norm, `normalize(${JSON.stringify(input)})`);
      assert.equal(isValid(input), ok, `isValid(${JSON.stringify(input)})`);
    }
  });
}

test("app.js e Code.gs dão o mesmo resultado para entradas extras", () => {
  const extra = ["55", "5", "555", "5555987654321", "55551198765432", "0 11 98765-4321", "abc", "  11 9 8765 4321  "];
  for (const input of [...CASES.map(c => c[0]), ...extra]) {
    assert.equal(app.normalizeBrPhone(input), gs.normalizeBrPhone_(input), `normalize ${JSON.stringify(input)}`);
    assert.equal(app.isValidBrMobile(input), gs.isValidBrMobile_(input), `isValid ${JSON.stringify(input)}`);
  }
});

test("maskPhone não trunca +55 e formata o número nacional", () => {
  assert.equal(app.maskPhone("+5511987654321"), "(11) 98765-4321");
  assert.equal(app.maskPhone("+55 11 98765-4321"), "(11) 98765-4321");
  assert.equal(app.maskPhone("+5511948818000"), "(11) 94881-8000");
  assert.equal(app.maskPhone("11987654321"), "(11) 98765-4321");
  assert.equal(app.maskPhone("55987654321"), "(55) 98765-4321");
  assert.equal(app.maskPhone("1198765432"), "(11) 9876-5432");
  assert.equal(app.maskPhone(""), "");
  assert.equal(app.maskPhone("1"), "(1");
  assert.equal(app.maskPhone("119"), "(11) 9");
});

test("maskPhone: digitando +55 dígito a dígito termina no número completo", () => {
  let field = "";
  for (const ch of "+5511987654321") field = app.maskPhone(field + ch);
  assert.equal(field, "(11) 98765-4321");
  assert.equal(app.normalizeBrPhone(field), "11987654321");
  assert.equal(app.isValidBrMobile(field), true);
  field = "";
  for (const ch of "+5555987654321") field = app.maskPhone(field + ch);  // +55 com DDD 55
  assert.equal(field, "(55) 98765-4321");
});

/* doPost com payload sintético: valida antes de gravar/enviar e grava o número nacional de 11 dígitos. */
function payload(whatsapp) {
  const p = { nome: "Teste", clinica: "Clínica Teste", especialidade: "Teste", whatsapp, consentimento: true,
    nota_geral: 50, faixa: "Teste", nota_atendimento: 50, nota_equipe: 50, nota_processos: 50, nota_financeiro: 50, nota_crescimento: 50 };
  for (let i = 1; i <= 15; i++) p["q" + i] = "A";
  return { postData: { contents: JSON.stringify(p) } };
}

test("Code.gs doPost grava 11 dígitos e mantém o link wa.me", () => {
  const { gs, calls } = loadGs();
  assert.deepEqual(gs.doPost(payload("+55 11 94881-8000")), { status: "ok" });
  assert.equal(calls.appendRow.length, 1);
  assert.equal(calls.appendRow[0][gs.FIELDS.indexOf("whatsapp")], "11948818000");
  assert.equal(calls.sendEmail.length, 1);
  assert.match(calls.sendEmail[0].body, /WhatsApp: 11948818000 {2}\(https:\/\/wa\.me\/5511948818000\)/);
});

test("Code.gs doPost DDD 55 grava o número sem tirar o 55", () => {
  const { gs, calls } = loadGs();
  assert.deepEqual(gs.doPost(payload("55987654321")), { status: "ok" });
  assert.equal(calls.appendRow[0][gs.FIELDS.indexOf("whatsapp")], "55987654321");
  // Comportamento herdado do link: replace(/^55/) também afeta DDD 55 (fora do escopo desta correção).
  assert.match(calls.sendEmail[0].body, /WhatsApp: 55987654321 /);
});

test("Code.gs doPost rejeita inválidos sem gravar nem enviar e-mail", () => {
  for (const bad of ["1133334444", "551133334444", "11187654321", "119876543", "119876543210", ""]) {
    const { gs, calls } = loadGs();
    assert.deepEqual(gs.doPost(payload(bad)), { status: "bad_whatsapp" }, JSON.stringify(bad));
    assert.equal(calls.appendRow.length, 0);
    assert.equal(calls.sendEmail.length, 0);
  }
});
