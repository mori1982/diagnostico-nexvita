/**
 * Diagnóstico de Gestão NexVita — receptor de leads (Google Apps Script Web App).
 * Recebe POST (corpo JSON em text/plain), grava na planilha e avisa por e-mail.
 * Se o lead marcou o consentimento, acrescenta também uma linha minimizada (sem nome/clínica/respostas,
 * telefone só em SHA-256) na PLANILHA DE UPLOAD separada, lida pelo Google Ads Data Manager.
 */
var NOTIFY_EMAIL = 'mori@nexvita.com';
var SHEET_NAME = 'Leads';
var MAX_BODY = 8000;   // bytes
var MAX_FIELD = 200;   // caracteres por campo

var FIELDS = ['timestamp','nome','clinica','especialidade','whatsapp','consentimento',
  'q1','q2','q3','q4','q5','q6','q7','q8','q9','q10','q11','q12','q13','q14','q15',
  'nota_geral','faixa','nota_atendimento','nota_equipe','nota_processos','nota_financeiro','nota_crescimento',
  'utm_source','utm_campaign','utm_medium','utm_content','origem','referrer','recebido_em'];

/* ---------- Planilha de upload (importação de conversões de clique no Google Ads Data Manager) ----------
 * Arquivo SEPARADO da planilha de Leads. O ID vem de Script Properties (Configurações do projeto >
 * Propriedades do script), chave UPLOAD_SHEET_ID = <ID da planilha dedicada>. Nada hardcoded aqui.
 * Sem a propriedade (ou ID inválido), o lead é gravado em Leads normalmente e só a escrita de upload é pulada.
 * O Data Manager lê só a PRIMEIRA aba: cabeçalho na linha 1, uma conversão por linha. */
var UPLOAD_SHEET_PROP = 'UPLOAD_SHEET_ID';
var UPLOAD_CONVERSION_NAME = 'Lead diagnóstico (importação)';
var UPLOAD_VALUE = 1;
var UPLOAD_CURRENCY = 'BRL';
var UPLOAD_HEADERS = ['Google Click ID', 'gbraid', 'wbraid', 'Conversion Name', 'Conversion Time',
  'Conversion Value', 'Conversion Currency', 'Order ID', 'Phone'];
var UPLOAD_ORDER_COL = UPLOAD_HEADERS.indexOf('Order ID');  // índice 0-based
var UPLOAD_PHONE_COL = UPLOAD_HEADERS.indexOf('Phone');

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > MAX_BODY) return out_('too_large');
    var d = JSON.parse(raw);
    if (d.website) return out_('ok'); // honeypot preenchido: descarta em silêncio

    var row = {};
    FIELDS.forEach(function (f) { row[f] = clean_(d[f]); });
    row.recebido_em = new Date().toISOString();

    // Validação
    if (!row.nome || !row.clinica || !row.especialidade) return out_('missing_fields');
    var digits = normalizeBrPhone_(row.whatsapp);
    if (!isValidBrMobile_(digits)) return out_('bad_whatsapp');
    row.whatsapp = digits;
    // Consentimento é opcional: sem marca o lead é gravado (consentimento=false) e não vai para a planilha de upload.
    row.consentimento = d.consentimento === true;
    for (var i = 1; i <= 15; i++) if (!/^[ABCD]$/.test(row['q' + i])) return out_('bad_answer');
    var nums = ['nota_geral','nota_atendimento','nota_equipe','nota_processos','nota_financeiro','nota_crescimento'];
    for (var j = 0; j < nums.length; j++) {
      var n = Number(row[nums[j]]);
      if (!(n >= 0 && n <= 100)) return out_('bad_score');
      row[nums[j]] = n;
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sh = sheet_();
      sh.appendRow(FIELDS.map(function (f) { return row[f]; }));
    } finally { lock.releaseLock(); }

    // Depois do lead gravado: linha de upload (só com consentimento). Falha aqui nunca derruba o doPost.
    try {
      writeUpload_(row, { gclid: cleanClickId_(d.gclid), gbraid: cleanClickId_(d.gbraid), wbraid: cleanClickId_(d.wbraid) });
    } catch (upErr) {
      console.error('upload: falhou, lead já gravado em Leads', upErr);
    }

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: 'Novo diagnóstico: ' + row.clinica + ' — nota ' + row.nota_geral,
      body: [
        'Nome: ' + row.nome, 'Clínica: ' + row.clinica, 'Especialidade: ' + row.especialidade,
        'WhatsApp: ' + row.whatsapp + '  (https://wa.me/55' + row.whatsapp.replace(/^55/, '') + ')',
        '', 'Nota geral: ' + row.nota_geral + ' (' + row.faixa + ')',
        'Atendimento: ' + row.nota_atendimento, 'Equipe: ' + row.nota_equipe,
        'Processos e agenda: ' + row.nota_processos, 'Financeiro: ' + row.nota_financeiro,
        'Crescimento: ' + row.nota_crescimento,
        '', 'Origem: ' + (row.origem || '-') + ' | utm_source: ' + (row.utm_source || '-') + ' | utm_campaign: ' + (row.utm_campaign || '-'),
        'Planilha: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
      ].join('\n')
    });
    return out_('ok');
  } catch (err) {
    console.error(err);
    return out_('error');
  }
}

function doGet() { return out_('alive'); }

function clean_(v) {
  if (v === undefined || v === null) return '';
  var s = String(v).replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, MAX_FIELD);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // evita injeção de fórmula na planilha
  return s;
}

// WhatsApp BR: só dígitos; tira o 55 do país quando sobram 10 ou 11 dígitos depois dele
// (DDD 55 com 11 dígitos, ex. 55987654321, fica como está). Mesma regra de app.js.
function normalizeBrPhone_(v) {
  var d = String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
  return /^55\d{10,11}$/.test(d) ? d.slice(2) : d;
}

// Celular BR: DDD + 9 + 8 dígitos (11 no total) depois de normalizar.
function isValidBrMobile_(v) { return /^\d{2}9\d{8}$/.test(normalizeBrPhone_(v)); }

/* ---------- Helpers puros da planilha de upload (testados em test_upload.js, sem serviços Google) ---------- */

// Identificador de clique do Google: só [A-Za-z0-9_-], até 200 caracteres; qualquer outra coisa vira ''.
function cleanClickId_(v) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  return /^[A-Za-z0-9_-]{1,200}$/.test(s) ? s : '';
}

// E.164 do celular BR: '+55' + DDD + 9 dígitos, depois de normalizeBrPhone_. Inválido => ''.
function toE164Br_(v) {
  var d = normalizeBrPhone_(v);
  return isValidBrMobile_(d) ? '+55' + d : '';
}

// SHA-256 em hex minúsculo (UTF-8). Utilities.computeDigest devolve bytes com sinal (-128..127).
function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return hex;
}

// Order ID estável e não pessoal: 'diag-' + SHA-256 hex de (recebido_em + telefone E.164).
function orderId_(recebidoEm, phoneE164) { return 'diag-' + sha256Hex_(String(recebidoEm) + String(phoneE164)); }

// ISO UTC -> 'yyyy-MM-dd HH:mm:ss-03:00' (America/Sao_Paulo; Brasil sem horário de verão desde 2019).
function conversionTime_(iso) {
  var t = Date.parse(iso);
  if (isNaN(t)) return '';
  var d = new Date(t - 3 * 3600 * 1000), p = function (n) { return ('0' + n).slice(-2); };
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
    p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + '-03:00';
}

// Regra: só com consentimento === true E (algum identificador de clique OU telefone válido).
function shouldUpload_(consentimento, ids, phoneE164) {
  if (consentimento !== true) return false;
  var hasClick = !!(ids && (ids.gclid || ids.gbraid || ids.wbraid));
  return hasClick || !!phoneE164;
}

// Linha minimizada, na ordem de UPLOAD_HEADERS. Sem nome, clínica, respostas ou telefone em claro.
// Devolve null quando a regra de upload não deixa escrever.
function buildUploadRow_(lead, ids) {
  ids = ids || {};
  var e164 = toE164Br_(lead.whatsapp);
  if (!shouldUpload_(lead.consentimento, ids, e164)) return null;
  var time = conversionTime_(lead.recebido_em);
  if (!time) return null;
  return [ids.gclid || '', ids.gbraid || '', ids.wbraid || '', UPLOAD_CONVERSION_NAME, time,
    UPLOAD_VALUE, UPLOAD_CURRENCY, orderId_(lead.recebido_em, e164), e164 ? sha256Hex_(e164) : ''];
}

// Mantém a 1ª ocorrência de cada Order ID; repetidas e linhas sem Order ID ou sem identificador
// (clique ou telefone hasheado) saem. rows = linhas de dados (sem cabeçalho). Devolve índices 0-based a remover.
function uploadRowsToRemove_(rows) {
  var seen = {}, out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], id = String(r[UPLOAD_ORDER_COL] || '');
    var hasKey = r[0] || r[1] || r[2] || r[UPLOAD_PHONE_COL];
    if (!id || !hasKey || seen[id]) { out.push(i); continue; }
    seen[id] = true;
  }
  return out;
}

/* ---------- Escrita na planilha de upload ---------- */

function uploadSheet_() {
  var id = String(PropertiesService.getScriptProperties().getProperty(UPLOAD_SHEET_PROP) || '').trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) return null;
  var sh = SpreadsheetApp.openById(id).getSheets()[0];  // Data Manager lê só a 1ª aba
  if (sh.getLastRow() === 0) { sh.appendRow(UPLOAD_HEADERS); sh.setFrozenRows(1); }
  return sh;
}

// Acrescenta a linha de upload do lead (se a regra permitir), sem repetir Order ID. Devolve o que fez.
function writeUpload_(lead, ids) {
  var line = buildUploadRow_(lead, ids);
  if (!line) return 'skipped_rule';
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = uploadSheet_();
    if (!sh) { console.warn('upload: Script Property ' + UPLOAD_SHEET_PROP + ' ausente ou inválida; linha não escrita'); return 'skipped_no_sheet'; }
    var last = sh.getLastRow();
    if (last > 1) {
      var existing = sh.getRange(2, UPLOAD_ORDER_COL + 1, last - 1, 1).getValues();
      for (var i = 0; i < existing.length; i++) if (String(existing[i][0]) === line[UPLOAD_ORDER_COL]) return 'duplicate';
    }
    var rng = sh.getRange(last + 1, 1, 1, line.length);
    rng.setNumberFormat('@');  // texto puro: o Sheets não converte a hora nem os IDs
    rng.setValues([line]);
    return 'written';
  } finally { lock.releaseLock(); }
}

/**
 * Rede de segurança para gatilho horário: deduplica a planilha de upload por Order ID (mantém a 1ª linha)
 * e remove linhas sem Order ID ou sem identificador (clique/telefone hasheado).
 * NÃO faz backfill a partir da aba Leads: ela não guarda gclid/gbraid/wbraid e leads antigos ou sem marca não
 * deram consentimento para medição de anúncios — copiar telefones de lá violaria o consentimento. A linha de
 * upload é escrita na hora pelo doPost; aqui só se arruma o que já está na planilha de upload.
 * Gatilho (NÃO instalado por este código): editor do Apps Script > Acionadores > Adicionar acionador >
 * função reconcileUploadSheet, origem "Baseado no tempo", tipo "Timer por hora", a cada 1 hora.
 */
function reconcileUploadSheet() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = uploadSheet_();
    if (!sh) { console.warn('reconcile: Script Property ' + UPLOAD_SHEET_PROP + ' ausente ou inválida'); return 0; }
    var last = sh.getLastRow();
    if (last < 2) return 0;
    var rows = sh.getRange(2, 1, last - 1, UPLOAD_HEADERS.length).getValues();
    var rm = uploadRowsToRemove_(rows);
    for (var k = rm.length - 1; k >= 0; k--) sh.deleteRow(rm[k] + 2);  // de baixo para cima
    if (rm.length) console.log('reconcile: ' + rm.length + ' linha(s) removida(s)');
    return rm.length;
  } finally { lock.releaseLock(); }
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) { sh.appendRow(FIELDS); sh.setFrozenRows(1); }
  return sh;
}

function out_(status) {
  return ContentService.createTextOutput(JSON.stringify({ status: status }))
    .setMimeType(ContentService.MimeType.JSON);
}
