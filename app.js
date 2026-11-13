/* Diagnóstico de Gestão NexVita — v1 front-end (sem dependências)
 * Dados: questions.json. Backend: implementar submitLead(data) (ver README). */
"use strict";

/* ============ INTEGRAÇÃO ============ */
const CFG = window.DIAG_CONFIG || {};
/** POST do lead para CFG.ENDPOINT_URL (Apps Script, ver apps-script/Code.gs).
 *  Corpo JSON em text/plain + no-cors (Apps Script não responde preflight CORS).
 *  Rejeita só em erro de rede; com ENDPOINT_URL vazio não envia nada. */
async function submitLead(payload) {
  if (!CFG.ENDPOINT_URL) return "skipped";
  await fetch(CFG.ENDPOINT_URL, { method: "POST", mode: "no-cors", keepalive: true,
    headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
  return "sent";
}
/** Envio em segundo plano: 1 tentativa + 1 retry após 3 s. Nunca bloqueia a tela. */
function sendInBackground(payload) {
  submitLead(payload).catch(() => new Promise(r => setTimeout(r, 3000)).then(() => submitLead(payload)))
    .catch(err => console.warn("[lead] envio falhou após retry", err));
}
/* =========================================== */

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const state = { data: null, i: 0, answers: {}, lead: null, result: null };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const params = new URLSearchParams(location.search);

async function init() {
  state.data = await (await fetch("questions.json")).json();
  const demo = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? params.get("demo") : null;               // ?demo=question|contact|result|cards (previews)
  if (demo) return runDemo(demo);
  renderIntro();
}

function go(html, focus = true) {
  app.innerHTML = html;
  window.scrollTo(0, 0);
  if (focus) app.focus({ preventScroll: true });
}

/* ---------- Bloco institucional (texto aprovado; usado na intro e no resultado) ---------- */
function aboutBlock() {
  const wa = String(CFG.WHATSAPP_NUMBER || "").replace(/\D/g, "");
  const phone = wa ? `<a href="https://wa.me/${wa}" target="_blank" rel="noopener">(11) 93624-4354</a>` : "(11) 93624-4354";
  return `<section class="about" aria-label="Sobre a NexVita">
    <h2>O que a NexVita é — e o que não é</h2>
    <p><strong>O que é.</strong> A NexVita é gente no WhatsApp, no tom da sua clínica, trabalhando junto com a equipe e o sistema que você já tem. Começa por um diagnóstico, sem pacote pronto. A partir daí, assume a retaguarda — atendimento, agenda, financeiro e equipe — desenhada para a rotina do seu consultório.</p>
    <p><strong>O que não é.</strong> Não é um software novo, nem um sistema para você trocar. Não substitui o seu prontuário nem a sua equipe. Não é um pacote fechado igual para toda clínica, e não faz consulta nem conduta médica: o ato médico continua com você.</p>
    <h2>Sistemas com que já trabalhamos</h2>
    <p>Já operamos no dia a dia com Feegow, iClinic e Clinicorp, e também com o sistema de agenda, prontuário e financeiro que a sua clínica já usa. Não é preciso trocar de ferramenta para começar.</p>
    <h2>Sigilo e LGPD</h2>
    <p>Os dados da sua clínica e dos seus pacientes são tratados com confidencialidade. Assinamos acordo de sigilo (NDA) antes de qualquer acesso a informações operacionais, e conduzimos o trabalho com respeito à LGPD.</p>
    <p class="about-close">O diagnóstico é gratuito e online. O WhatsApp da equipe NexVita é o ${phone}.</p>
  </section>`;
}

/* ---------- 1. Intro ---------- */
function renderIntro() {
  const d = state.data;
  go(`<section class="stack">
    <div class="hero stack">
      <p class="over">Diagnóstico gratuito para clínicas</p>
      <h1>Qual é a nota de gestão da sua clínica?</h1>
      <p>Responda ${d.questions.length} perguntas rápidas e receba uma nota de 0 a 100, com o ponto forte e o ponto que mais trava a sua clínica.</p>
    </div>
    <div class="facts">
      <div class="fact"><b class="num">3</b><span>minutos</span></div>
      <div class="fact"><b class="num">${d.questions.length}</b><span>perguntas</span></div>
      <div class="fact"><b class="num">${d.areas.length}</b><span>áreas</span></div>
    </div>
    <ul class="areas-list">${d.areas.map(a => `<li>${esc(a.name)}</li>`).join("")}</ul>
    <button class="btn btn-primary" id="start">Começar</button>
    <p class="small" style="text-align:center">Gratuito. Sem cadastro para responder.</p>
    ${aboutBlock()}
  </section>`, false);
  $("#start").onclick = () => { state.i = 0; renderQuestion(); };
}

/* ---------- 2. Pergunta ---------- */
function renderQuestion() {
  const { questions, areas } = state.data, q = questions[state.i];
  const area = areas.find(a => a.id === q.area), n = questions.length;
  const sel = state.answers[q.id];
  go(`<section class="q">
    <div class="prog-row"><span class="over">${esc(area.name)}</span><span class="num">${state.i + 1} de ${n}</span></div>
    <div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${state.i + 1}"><i style="width:${((state.i + 1) / n) * 100}%"></i></div>
    <h2 id="qt">${esc(q.text)}</h2>
    <div class="opts" role="radiogroup" aria-labelledby="qt">
      ${q.options.map((o, k) => `<button class="opt" role="radio" aria-checked="${sel === k}" data-k="${k}"><span class="dot"></span><span>${esc(o.label)}</span></button>`).join("")}
    </div>
    <button class="back" id="back">← Voltar</button>
  </section>`);
  app.querySelectorAll(".opt").forEach(b => b.onclick = () => {
    state.answers[q.id] = +b.dataset.k;
    app.querySelectorAll(".opt").forEach(x => x.setAttribute("aria-checked", x === b));
    setTimeout(() => { state.i < n - 1 ? (state.i++, renderQuestion()) : renderContact(); }, 220);
  });
  $("#back").onclick = () => state.i > 0 ? (state.i--, renderQuestion()) : renderIntro();
}

/* ---------- Pontuação ---------- */
function score() {
  const { areas, questions, levels, scoring } = state.data, max = scoring?.maxPerQuestion ?? 4;
  const th = scoring?.insightThresholds ?? { mid: 40, high: 70 };
  const per = areas.map(a => {
    const qs = questions.filter(q => q.area === a.id);
    const pts = qs.reduce((s, q) => s + (q.options[state.answers[q.id]]?.points ?? 0), 0);
    const raw = (pts / (qs.length * max)) * 100, v = Math.round(raw);
    const band = v >= th.high ? "high" : v >= th.mid ? "mid" : "low";
    return { ...a, raw, score: v, band, insight: a.insights?.[band] ?? "" };
  });
  const overall = Math.round(per.reduce((s, a) => s + a.raw, 0) / per.length);  // média das áreas sem arredondar; faixa sobre a nota arredondada
  const li = levels.findIndex(l => overall >= l.min && overall <= l.max);
  const sorted = [...per].sort((a, b) => b.score - a.score);
  return { overall, level: levels[li], levelIndex: li, areas: per, strongest: sorted[0], weakest: sorted[sorted.length - 1] };
}

/* ---------- 3. Contato ---------- */
function renderContact() {
  go(`<section class="stack">
    <p class="over">Último passo</p>
    <h1 style="font-size:28px">Seu diagnóstico está pronto</h1>
    <p class="small" style="font-size:16px">Diga para quem é o resultado. Ele aparece na próxima tela.</p>
    <form id="f" class="stack" novalidate>
      <div class="field"><label for="nome">Seu nome</label><input id="nome" name="nome" autocomplete="name" placeholder="Dra. Ana Souza" required maxlength="120"><p class="err">Informe seu nome.</p></div>
      <div class="field"><label for="whatsapp">WhatsApp</label><input id="whatsapp" name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" placeholder="(11) 98765-4321" required><p class="err">Informe um WhatsApp com DDD.</p></div>
      <div class="field"><label for="clinica">Nome da clínica</label><input id="clinica" name="clinica" autocomplete="organization" placeholder="Clínica Vida" required maxlength="120"><p class="err">Informe o nome da clínica.</p></div>
      <div class="field"><label for="especialidade">Especialidade</label><input id="especialidade" name="especialidade" placeholder="Dermatologia" required maxlength="120"><p class="err">Informe a especialidade.</p></div>
      <div aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden"><label for="website">Site</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
      <label class="consent"><input type="checkbox" id="lgpd" required><span>Concordo que a NexVita use estes dados para enviar meu resultado e entrar em contato, conforme a <a href="privacidade.html" id="priv" target="_blank" rel="noopener">Política de Privacidade</a> (LGPD). Posso pedir a exclusão a qualquer momento.</span></label>
      <div id="ferr" class="alert" hidden></div>
      <button class="btn btn-primary" id="send" type="submit">Ver meu resultado</button>
      <p class="lock">🔒 Seus dados não são compartilhados.</p>
    </form>
  </section>`);
  const tel = $("#whatsapp");
  tel.oninput = () => { tel.value = maskPhone(tel.value); };
  $("#f").onsubmit = async e => {
    e.preventDefault();
    const f = e.target, v = id => $("#" + id).value.trim();
    const checks = { nome: v("nome").length > 1, whatsapp: /^\d{10,11}$/.test(v("whatsapp").replace(/\D/g, "")), clinica: v("clinica").length > 1, especialidade: v("especialidade").length > 1 };
    Object.entries(checks).forEach(([k, ok]) => $("#" + k).closest(".field").classList.toggle("invalid", !ok));
    const ferr = $("#ferr");
    if (!Object.values(checks).every(Boolean)) return;
    if (!$("#lgpd").checked) { ferr.hidden = false; ferr.textContent = "Marque o consentimento para ver o resultado."; return; }
    ferr.hidden = true;
    const r = score(); state.result = r;
    state.lead = { nome: v("nome"), clinica: v("clinica"), especialidade: v("especialidade") };
    const u = Object.fromEntries([...params].filter(([k]) => k.startsWith("utm_")));
    const payload = { timestamp: new Date().toISOString(), nome: v("nome"), clinica: v("clinica"), especialidade: v("especialidade"),
      whatsapp: v("whatsapp").replace(/\D/g, ""), consentimento: true, website: v("website"),
      utm_source: u.utm_source || "", utm_campaign: u.utm_campaign || "", utm_medium: u.utm_medium || "", utm_content: u.utm_content || "",
      origem: params.get("src") || "", referrer: document.referrer || "direto",
      nota_geral: r.overall, faixa: r.level.label };
    state.data.questions.forEach(q => payload[q.id] = "ABCD"[state.answers[q.id]]);
    r.areas.forEach(a => payload["nota_" + a.id] = a.score);
    state.payload = payload;
    sendInBackground(payload);
    try { window.NVTrack && NVTrack.lead(); } catch (e) {}
    renderResult();
  };
}
function maskPhone(val) {
  const d = val.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? "(" + d : "";
  if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

/* ---------- 4. Resultado ---------- */
function waLink(r) {
  const inv = state.data.invite;
  const L = state.lead || {}, msg = inv.whatsappMessage.replace("[NOME]", L.nome || "").replace("[CLINICA]", L.clinica || "").replace("[NOTA]", r.overall);
  return `https://wa.me/${String(CFG.WHATSAPP_NUMBER || "").replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
}
function renderResult() {
  const r = state.result, inv = state.data.invite, C = 2 * Math.PI * 78;
  const first = state.lead?.nome?.split(" ").filter(w => !/^dr\.?a?\.?$/i.test(w))[0] || "";
  go(`<section class="stack" style="--gap:24px">
    <div class="score-card">
      <p class="over">${first ? esc(first) + ", a nota da sua clínica" : "A nota da sua clínica"}</p>
      <div class="ring" role="img" aria-label="Nota ${r.overall} de 100">
        <svg width="180" height="180" viewBox="0 0 180 180"><circle cx="90" cy="90" r="78" fill="none" stroke="var(--c-surface-2)" stroke-width="14"/>
        <circle cx="90" cy="90" r="78" fill="none" stroke="var(--c-primary)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - r.overall / 100)}"/></svg>
        <div class="val"><b class="num">${r.overall}</b><span class="num">de 100</span></div>
      </div>
      <span class="badge lv-${r.levelIndex}">${esc(r.level.label)}</span>
      <p style="margin-top:12px;color:var(--c-text-2)">${esc(r.level.description)}</p>
    </div>
    <div class="hl">
      <div><small>Ponto forte</small><b>${esc(r.strongest.name)}</b><span class="num small">${r.strongest.score}/100</span></div>
      <div><small>Mais trava</small><b>${esc(r.weakest.name)}</b><span class="num small">${r.weakest.score}/100</span></div>
    </div>
    <h2 style="margin-top:32px">Sua nota por área</h2>
    <div class="bars" id="r-areas">${r.areas.map(a => `<div data-area="${a.id}" data-score="${a.score}" data-band="${a.band}"><div class="bar-h"><span>${esc(a.name)}</span><span class="num">${a.score}</span></div>
      <div class="bar"><i class="${a.band}" style="width:${Math.max(a.score, 2)}%"></i></div><p>${esc(a.insight)}</p></div>`).join("")}</div>
    <div class="cta-box stack" style="margin-top:32px">
      <h2>${esc(inv.text.split("?")[0].replace("[NOTA]", r.overall).split(". ")[0])}.</h2>
      <p>${esc(inv.text.replace("[NOTA]", r.overall).split(". ").slice(1).join(". "))}</p>
      <p style="font-family:var(--font-serif);color:#fff">— ${esc(inv.signature)}</p>
      <a class="btn btn-primary" id="r-wa" href="${waLink(r)}" target="_blank" rel="noopener">${esc(inv.button)}</a>
    </div>
    ${aboutBlock()}
    <h2 style="margin-top:32px">Compartilhe seu resultado</h2>
    <div class="share-row">
      <button class="btn btn-ghost" id="dl-feed">Baixar post (4:5)</button>
      <button class="btn btn-ghost" id="dl-story">Baixar story (9:16)</button>
    </div>
    <img id="share-prev" class="share-prev" alt="Prévia do card de resultado">
    <button class="btn btn-ghost" id="redo">Refazer diagnóstico</button>
  </section>`);
  $("#r-wa").addEventListener("click", () => { try { window.NVTrack && NVTrack.contact(); } catch (e) {} });
  $("#dl-feed").onclick = () => downloadCard("feed");
  $("#dl-story").onclick = () => downloadCard("story");
  $("#redo").onclick = () => { state.answers = {}; renderIntro(); };
  makeCard("feed").then(c => $("#share-prev").src = c.toDataURL("image/png"));
}

/* ---------- Card compartilhável (canvas, 100% client-side) ---------- */
const COLORS = { pet: "#07383D", deep: "#04292D", med: "#165559", aqua: "#9FC3C4", aquaC: "#C4D6D7", nev: "#EEF3F3", white: "#FFFFFF" };
const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

async function makeCard(format) {
  const r = state.result, W = 1080, H = format === "story" ? 1920 : 1350;
  await document.fonts.load('400 80px "Hedvig Letters Serif"'); await document.fonts.load('600 80px "Inter"'); await document.fonts.ready;
  const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  const serif = s => `400 ${s}px "Hedvig Letters Serif", Georgia, serif`, sans = (w, s) => `${w} ${s}px Inter, system-ui, sans-serif`;
  x.fillStyle = COLORS.pet; x.fillRect(0, 0, W, H);
  const story = format === "story", top = story ? 200 : 96, P = 96;
  const logo = await loadImg("assets/nexvita-papel.png");
  const lw = 300; x.drawImage(logo, (W - lw) / 2, top, lw, lw * logo.height / logo.width);
  x.textAlign = "center"; x.fillStyle = COLORS.aqua; x.font = sans(600, 28);
  x.letterSpacing = "3px"; x.fillText("DIAGNÓSTICO DE GESTÃO", W / 2, top + 140); x.letterSpacing = "0px";
  // anel
  const cy = top + (story ? 470 : 380), R = story ? 210 : 175;
  x.lineWidth = 34; x.lineCap = "round"; x.strokeStyle = "rgba(159,195,196,.22)";
  x.beginPath(); x.arc(W / 2, cy, R, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = COLORS.aqua; x.beginPath(); x.arc(W / 2, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * r.overall / 100); x.stroke();
  x.fillStyle = COLORS.white; x.font = sans(600, story ? 170 : 150); x.textBaseline = "middle";
  x.fillText(String(r.overall), W / 2, cy - 10); x.font = sans(500, 30); x.fillStyle = COLORS.aquaC; x.fillText("de 100", W / 2, cy + (story ? 95 : 80));
  x.textBaseline = "alphabetic";
  x.fillStyle = COLORS.white; x.font = serif(story ? 72 : 64); x.fillText(r.level.label, W / 2, cy + R + (story ? 140 : 120));
  // barras
  let y = cy + R + (story ? 240 : 190); const gap = story ? 110 : 82, bw = W - 2 * P;
  r.areas.forEach(a => {
    x.textAlign = "left"; x.fillStyle = COLORS.aquaC; x.font = sans(500, story ? 32 : 28); x.fillText(a.name, P, y);
    x.textAlign = "right"; x.fillStyle = COLORS.white; x.font = sans(600, story ? 34 : 30); x.fillText(String(a.score), W - P, y);
    x.fillStyle = "rgba(159,195,196,.22)"; rr(x, P, y + 18, bw, 14, 7);
    x.fillStyle = COLORS.aqua; rr(x, P, y + 18, Math.max(14, bw * a.score / 100), 14, 7);
    y += gap;
  });
  x.textAlign = "center"; x.fillStyle = COLORS.aquaC; x.font = sans(500, 28);
  x.fillText(story ? "Faça o seu: comente PLANO no meu post" : "Faça o seu diagnóstico · comente PLANO", W / 2, H - (story ? 200 : 80));
  return c;
}
function rr(x, X, Y, w, h, r) { x.beginPath(); x.roundRect(X, Y, w, h, r); x.fill(); }
async function downloadCard(format) {
  const c = await makeCard(format);
  c.toBlob(async blob => {
    const file = new File([blob], `diagnostico-nexvita-${format}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] }) && matchMedia("(pointer:coarse)").matches) {
      try { return await navigator.share({ files: [file], title: "Meu Diagnóstico de Gestão NexVita" }); } catch {}
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, "image/png");
}

/* ---------- Demo para previews ---------- */
function runDemo(screen) {
  const demo = [3, 2, 2, 1, 1, 2, 1, 2, 1, 1, 0, 1, 2, 1, 0];  // índices de alternativa
  state.data.questions.forEach((q, k) => state.answers[q.id] = demo[k]);
  state.lead = { nome: "Dra. Ana Souza" }; state.result = score();
  if (screen === "question") { state.i = 2; state.answers.q3 = undefined; delete state.answers.q3; renderQuestion(); state.answers.q3 = 2; app.querySelectorAll(".opt")[2].setAttribute("aria-checked", true); }
  else if (screen === "contact") renderContact();
  else if (screen === "result") renderResult();
  else if (screen === "feed" || screen === "story") makeCard(screen).then(c => { document.body.innerHTML = ""; document.body.style.margin = 0; c.style.display = "block"; document.body.append(c); document.title = "ready"; });
  else renderIntro();
}

init().catch(e => { console.error(e); app.innerHTML = `<p class="alert">Não conseguimos carregar o diagnóstico. Atualize a página e tente de novo.</p>`; });
