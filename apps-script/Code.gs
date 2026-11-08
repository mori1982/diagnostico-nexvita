/**
 * Diagnóstico de Gestão NexVita — receptor de leads (Google Apps Script Web App).
 * Recebe POST (corpo JSON em text/plain), grava na planilha e avisa por e-mail.
 *
 * Não envia WhatsApp. Este runtime não tem adaptador de provedor: não há
 * UrlFetch para Cloud API, BSP ou sessão de navegador. Colunas wa_* no fim
 * da linha dizem por que não houve tentativa. accepted/sent/delivered/failed
 * só existem no classificador de recibo usado em teste com mock; doPost não
 * recebe recibo do navegador e não grava message_id.
 *
 * A linha é gravada antes do e-mail. Falha de e-mail não apaga o lead.
 * Implantar este arquivo é manual; o repositório não publica o Apps Script.
 */
var NOTIFY_EMAIL = 'mori@nexvita.com';
var SHEET_NAME = 'Leads';
var MAX_BODY = 8000;   // bytes
var MAX_FIELD = 200;   // caracteres por campo

var FIELDS = ['timestamp','nome','clinica','especialidade','whatsapp','consentimento',
  'q1','q2','q3','q4','q5','q6','q7','q8','q9','q10','q11','q12','q13','q14','q15',
  'nota_geral','faixa','nota_atendimento','nota_equipe','nota_processos','nota_financeiro','nota_crescimento',
  'utm_source','utm_campaign','utm_medium','utm_content','origem','referrer','recebido_em',
  'wa_idempotency_key','wa_disposition','wa_attempt','wa_reason','wa_provider'];

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > MAX_BODY) return out_('too_large');
    var d = JSON.parse(raw);
    if (d.website) return out_('ok'); // honeypot preenchido: descarta em silêncio

    var row = {};
    FIELDS.forEach(function (f) { row[f] = clean_(d[f]); });
    row.recebido_em = new Date().toISOString();

    if (!row.nome || !row.clinica || !row.especialidade) return out_('missing_fields');
    var digits = String(row.whatsapp).replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) return out_('bad_whatsapp');
    row.whatsapp = digits;
    if (d.consentimento !== true) return out_('no_consent');
    for (var i = 1; i <= 15; i++) if (!/^[ABCD]$/.test(row['q' + i])) return out_('bad_answer');
    var nums = ['nota_geral','nota_atendimento','nota_equipe','nota_processos','nota_financeiro','nota_crescimento'];
    for (var j = 0; j < nums.length; j++) {
      var n = Number(row[nums[j]]);
      if (!(n >= 0 && n <= 100)) return out_('bad_score');
      row[nums[j]] = n;
    }

    var leadKey = leadKeyFor(row.timestamp, row.whatsapp);
    var plan;
    var decision;
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sh = sheet_();
      plan = planWhatsAppHandoff({
        consent: d.consentimento === true,
        leadKey: leadKey,
        seenKeys: readLeadKeys_(sh),
        providerName: whatsAppProviderName_()
      });
      decision = leadWriteDecision(plan);
      if (decision.write) sh.appendRow(appendCells(row, plan));
    } finally {
      lock.releaseLock();
    }

    if (plan.disposition === 'blocked_no_consent') return out_('no_consent');
    if (!decision.email) return out_('ok');

    try {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: 'Novo diagnóstico: ' + row.clinica + ' — nota ' + row.nota_geral,
        body: [
          'Nome: ' + row.nome, 'Clínica: ' + row.clinica, 'Especialidade: ' + row.especialidade,
          'WhatsApp do lead (não é status de envio): ' + row.whatsapp + '  (link manual: https://wa.me/55' + row.whatsapp.replace(/^55/, '') + ')',
          '', 'Nota geral: ' + row.nota_geral + ' (' + row.faixa + ')',
          'Atendimento: ' + row.nota_atendimento, 'Equipe: ' + row.nota_equipe,
          'Processos e agenda: ' + row.nota_processos, 'Financeiro: ' + row.nota_financeiro,
          'Crescimento: ' + row.nota_crescimento,
          '', 'Origem: ' + (row.origem || '-') + ' | utm_source: ' + (row.utm_source || '-') + ' | utm_campaign: ' + (row.utm_campaign || '-'),
          'Planilha: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl(),
          whatsAppAlertLine(plan)
        ].join('\n')
      });
    } catch (mailErr) {
      console.error('notify_email_failed:' + (mailErr && mailErr.name ? mailErr.name : 'Error'));
    }
    return out_('ok');
  } catch (err) {
    console.error('lead_post_failed:' + (err && err.name ? err.name : 'Error'));
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

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getMaxColumns() < FIELDS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), FIELDS.length - sh.getMaxColumns());
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(FIELDS);
    sh.setFrozenRows(1);
    return sh;
  }
  // getRange(row, column, numRows, numColumns): uma linha e FIELDS.length colunas.
  var headers = sh.getRange(1, 1, 1, FIELDS.length).getValues()[0];
  var fills = headerFillPlan(headers, FIELDS);
  for (var i = 0; i < fills.length; i++) sh.getRange(1, fills[i].col).setValue(fills[i].value);
  return sh;
}

function readLeadKeys_(sh) {
  var col = FIELDS.indexOf('wa_idempotency_key') + 1;
  var n = sheetDataRows_(sh.getLastRow());
  if (!n || col < 1 || sh.getMaxColumns() < col) return [];
  // getRange(row, column, numRows, numColumns) — n linhas a partir da linha 2.
  var values = sh.getRange(2, col, n, 1).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var key = normalizeLeadKey(values[i][0]);
    if (key) out.push(key);
  }
  return out;
}

function whatsAppProviderName_() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty('WHATSAPP_PROVIDER');
    return v ? String(v) : '';
  } catch (ignore) {
    return '';
  }
}

function out_(status) {
  return ContentService.createTextOutput(JSON.stringify({ status: status }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- WhatsApp: decisão pura, sem rede e sem segredo ---------- */

var WA_DISPOSITIONS = {
  blocked_no_consent: 1, duplicate: 1, provider_unconfigured: 1, provider_rejected: 1,
  accepted: 1, sent: 1, delivered: 1, failed: 1
};
var WA_REASONS = {
  no_consent: 1, already_stored: 1, no_provider: 1, unknown_provider: 1,
  unrecognized_receipt: 1, provider_failed: 1
};

function sheetDataRows_(lastRow) {
  return lastRow < 2 ? 0 : lastRow - 1;
}

function headerFillPlan(existing, fields) {
  var updates = [];
  existing = existing || [];
  for (var i = 0; i < fields.length; i++) {
    var cur = i < existing.length ? existing[i] : '';
    if (cur === '' || cur === null || cur === undefined) updates.push({ col: i + 1, value: fields[i] });
  }
  return updates;
}

function leadKeyMaterial(timestamp, whatsappDigits) {
  var ts = String(timestamp || '');
  var phone = String(whatsappDigits || '').replace(/\D/g, '');
  if (!ts || !phone) return '';
  return ts + '|' + phone;
}

function leadKeyFor(timestamp, whatsappDigits) {
  var material = leadKeyMaterial(timestamp, whatsappDigits);
  if (!material) return '';
  return normalizeLeadKey(sha256Hex(material));
}

function normalizeLeadKey(key) {
  var s = String(key || '').toLowerCase();
  return /^[a-f0-9]{64}$/.test(s) ? s : '';
}

function planWhatsAppHandoff(opts) {
  opts = opts || {};
  var leadKey = normalizeLeadKey(opts.leadKey);
  var seen = opts.seenKeys || [];
  if (opts.consent !== true) {
    return waPlan_('skip', 'blocked_no_consent', 0, false, 'no_consent', leadKey, 'none');
  }
  if (leadKey && seen.indexOf(leadKey) !== -1) {
    return waPlan_('skip', 'duplicate', 0, false, 'already_stored', leadKey, 'none');
  }
  var provider = String(opts.providerName || '').replace(/^\s+|\s+$/g, '');
  if (!provider) {
    return waPlan_('skip', 'provider_unconfigured', 0, false, 'no_provider', leadKey, 'none');
  }
  // Recibo mock só quando o teste injeta o objeto. doPost não passa mockReceipt.
  if (provider === 'mock' && opts.mockReceipt && typeof opts.mockReceipt === 'object') {
    var classified = classifyProviderReceipt(opts.mockReceipt);
    classified.leadKey = leadKey;
    return classified;
  }
  return waPlan_('skip', 'provider_rejected', 0, false, 'unknown_provider', leadKey, 'unrecognized');
}

function classifyProviderReceipt(receipt) {
  var outcomes = { accepted: 1, sent: 1, delivered: 1, failed: 1 };
  var outcome = receipt && outcomes[receipt.outcome] ? receipt.outcome : '';
  if (!outcome) {
    return waPlan_('record_only', 'failed', 1, false, 'unrecognized_receipt', '', 'mock');
  }
  return waPlan_(
    'record_only',
    outcome,
    1,
    outcome === 'failed' && receipt.retryable === true,
    outcome === 'failed' ? 'provider_failed' : '',
    '',
    'mock'
  );
}

function waPlan_(action, disposition, attempt, retryable, reason, leadKey, provider) {
  return {
    action: action,
    disposition: disposition,
    attempt: attempt,
    retryable: retryable === true,
    reason: reason,
    leadKey: leadKey || '',
    provider: provider
  };
}

function leadWriteDecision(plan) {
  var skip = plan && (plan.disposition === 'duplicate' || plan.disposition === 'blocked_no_consent');
  return { write: !skip, email: !skip };
}

function whatsAppColumns(plan) {
  plan = plan || {};
  var disposition = WA_DISPOSITIONS[plan.disposition] ? plan.disposition : 'provider_unconfigured';
  var reason = WA_REASONS[plan.reason] ? plan.reason : '';
  var provider = plan.provider === 'mock' || plan.provider === 'unrecognized' || plan.provider === 'none'
    ? plan.provider : 'none';
  var attempt = plan.attempt === 0 || plan.attempt === 1 || plan.attempt === 2 || plan.attempt === 3
    ? plan.attempt : 0;
  return {
    wa_idempotency_key: normalizeLeadKey(plan.leadKey),
    wa_disposition: disposition,
    wa_attempt: attempt,
    wa_reason: reason,
    wa_provider: provider
  };
}

function appendCells(row, plan) {
  var cols = whatsAppColumns(plan);
  return FIELDS.map(function (f) {
    if (Object.prototype.hasOwnProperty.call(cols, f)) return cols[f];
    var v = row ? row[f] : '';
    return v === undefined || v === null ? '' : v;
  });
}

function whatsAppAlertLine(plan) {
  var cols = whatsAppColumns(plan);
  var line = 'WhatsApp automatico: ' + cols.wa_disposition + ' attempt=' + cols.wa_attempt + ' provider=' + cols.wa_provider;
  if (cols.wa_reason) line += ' reason=' + cols.wa_reason;
  return line;
}

function sha256Hex(text) {
  var bytes = utf8Bytes_(String(text));
  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  var hi = Math.floor(bitLen / 0x100000000);
  var lo = bitLen >>> 0;
  var i;
  for (i = 3; i >= 0; i--) bytes.push((hi >>> (i * 8)) & 255);
  for (i = 3; i >= 0; i--) bytes.push((lo >>> (i * 8)) & 255);
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  for (var off = 0; off < bytes.length; off += 64) {
    var W = [];
    for (i = 0; i < 16; i++) {
      W[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    }
    for (i = 16; i < 64; i++) {
      W[i] = u32_(sigma1_(W[i - 2]) + W[i - 7] + sigma0_(W[i - 15]) + W[i - 16]);
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (i = 0; i < 64; i++) {
      var t1 = u32_(h + big1_(e) + ch_(e, f, g) + K[i] + W[i]);
      var t2 = u32_(big0_(a) + maj_(a, b, c));
      h = g; g = f; f = e; e = u32_(d + t1); d = c; c = b; b = a; a = u32_(t1 + t2);
    }
    H[0] = u32_(H[0] + a); H[1] = u32_(H[1] + b); H[2] = u32_(H[2] + c); H[3] = u32_(H[3] + d);
    H[4] = u32_(H[4] + e); H[5] = u32_(H[5] + f); H[6] = u32_(H[6] + g); H[7] = u32_(H[7] + h);
  }
  var hex = '';
  for (i = 0; i < 8; i++) hex += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
  return hex;
}

function u32_(n) { return (n >>> 0); }
function rotr_(n, x) { return (x >>> n) | (x << (32 - n)); }
function big0_(x) { return rotr_(2, x) ^ rotr_(13, x) ^ rotr_(22, x); }
function big1_(x) { return rotr_(6, x) ^ rotr_(11, x) ^ rotr_(25, x); }
function sigma0_(x) { return rotr_(7, x) ^ rotr_(18, x) ^ (x >>> 3); }
function sigma1_(x) { return rotr_(17, x) ^ rotr_(19, x) ^ (x >>> 10); }
function ch_(x, y, z) { return (x & y) ^ (~x & z); }
function maj_(x, y, z) { return (x & y) ^ (x & z) ^ (y & z); }

function utf8Bytes_(s) {
  var bytes = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      var c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
        c = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        i++;
      }
    }
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    else if (c < 0x10000) bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    else bytes.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
  }
  return bytes;
}
