/**
 * Diagnóstico de Gestão NexVita — receptor de leads (Google Apps Script Web App).
 * Recebe POST (corpo JSON em text/plain), grava na planilha e avisa por e-mail.
 */
var NOTIFY_EMAIL = 'mori@nexvita.com';
var SHEET_NAME = 'Leads';
var MAX_BODY = 8000;   // bytes
var MAX_FIELD = 200;   // caracteres por campo

var FIELDS = ['timestamp','nome','clinica','especialidade','whatsapp','consentimento',
  'q1','q2','q3','q4','q5','q6','q7','q8','q9','q10','q11','q12','q13','q14','q15',
  'nota_geral','faixa','nota_atendimento','nota_equipe','nota_processos','nota_financeiro','nota_crescimento',
  'utm_source','utm_campaign','utm_medium','utm_content','origem','referrer','recebido_em'];

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

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sh = sheet_();
      sh.appendRow(FIELDS.map(function (f) { return row[f]; }));
    } finally { lock.releaseLock(); }

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
