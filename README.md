# Diagnóstico de Gestão NexVita — front-end v1

Site estático, sem build e sem dependências. Para rodar local: `python3 -m http.server` nesta pasta e abra `http://localhost:8000`. Precisa ser servido por HTTP (o `fetch("questions.json")` não funciona em `file://`).

## Arquivos
| Arquivo | O que é |
|---|---|
| `index.html` | Casca da página (logo, `<main id="app">`, rodapé) |
| `tokens.css` | Tokens oficiais da marca (cópia de `nexvita-brand/tokens.css`, **não editar aqui**) |
| `styles.css` | Estilos das telas, só com variáveis dos tokens |
| `app.js` | Fluxo: intro → 15 perguntas → contato → resultado + card compartilhável |
| `questions.json` | Conteúdo e pontuação (texto real da Virginia, v1 rascunho) |
| `assets/` | Logo petróleo, logo papel (para o card) e ícone XV (favicon) |
| `preview/` | PNGs das telas (390px) e dos cards 1080×1350 / 1080×1920 |

## Schema do `questions.json`
```jsonc
{
  "scoring": { "maxPerQuestion": 4, "insightThresholds": { "mid": 40, "high": 70 } },
  "areas":    [{ "id": "atendimento", "name": "Atendimento e experiência do paciente",
                 "insights": { "low": "...", "mid": "...", "high": "..." } }],
  "questions":[{ "id": "q1", "area": "atendimento", "text": "...?",
                 "options": [{ "label": "Mais de um dia", "points": 0 }, ...] }],
  "levels":   [{ "min": 0, "max": 39, "label": "Operação no limite", "description": "..." }],
  "invite":   { "text": "Sua clínica tirou [NOTA]. ...", "signature": "Mori, NexVita",
                "button": "Quero conversar com o Mori",
                "whatsappNumber": "5500000000000",   // ← TROCAR pelo número do Mori (DDI+DDD+número, só dígitos)
                "whatsappMessage": "Oi Mori, ... tirou [NOTA]. ..." }
}
```
Regras: nota da área = soma dos pontos / (nº de perguntas da área × `maxPerQuestion`) × 100; nota geral = média das áreas (arredondada). Insight: `< mid` → low, `< high` → mid, senão high. `[NOTA]` é substituído pela nota geral. Mudar perguntas/textos = só editar o JSON.

## Onde ligar o backend: `submitLead(data)`
No topo do `app.js`. Hoje é um stub (console + 700 ms). Deve retornar uma Promise e **rejeitar** em erro (a tela mostra "Não conseguimos enviar…" e deixa tentar de novo). O resultado só aparece depois do envio dar certo.
```js
data = {
  nome, whatsapp: "+5511987654321", clinica,            // clinica = "nome · especialidade" (campo livre)
  consentimento: true, consentimentoEm: "ISO-8601",     // registro LGPD
  respostas: { q1: 2, ... },                            // índice da alternativa escolhida
  notas: { geral: 43, areas: { atendimento: 83, ... } }, nivel: "Base em construção",
  utm: { utm_source, ... },                             // repassa ?utm_* da URL
  origem: document.referrer
}
```
Sugestão: validar de novo no servidor e recalcular a nota a partir de `respostas` (não confiar no cliente). O link da Política de Privacidade (`#priv`) está como `#` — apontar para a página real.

## Card compartilhável
Gerado em `<canvas>` puro (`makeCard("feed"|"story")` em `app.js`), 1080×1350 e 1080×1920, com o logo `assets/nexvita-papel.png`, Hedvig e Inter. `downloadCard()` usa o Web Share API com arquivo no celular (abre "Salvar imagem"/Instagram) e cai para download de PNG no desktop. Tudo client-side; não precisa de servidor nem de html-to-image. Se o logo for servido de outro domínio, precisa de CORS, senão o canvas fica "tainted" e o download falha.

## Previews / QA
`?demo=intro|question|contact|result|feed|story` renderiza cada tela com respostas de exemplo (usado para gerar `preview/`). Pode remover `runDemo` em produção.

## Pendências
- Número de WhatsApp do Mori (`invite.whatsappNumber`).
- URL da política de privacidade.
- Domínio/URL final (ex. `diagnostico.nexvita.com.br`) e meta tags OG para o link no Instagram.
- Textos da Virginia estão marcados como rascunho aguardando revisão do Mori.

## Integração (v1 unificada, 04/11)
- `config.js`: `ENDPOINT_URL` (Apps Script /exec; vazio = não envia) e `WHATSAPP_NUMBER` (único lugar do número; placeholder 5500000000000).
- `submitLead` faz POST text/plain no-cors; envio em segundo plano com 1 retry após 3 s; o resultado aparece mesmo se falhar.
- Payload plano no formato de `apps-script/Code.gs` (q1..q15 = A–D, nota_*, faixa, utm_*, origem=?src=, referrer, website=honeypot).
- Insight por área: baixa <40, média 40–79, alta ≥80. Nota geral = round(média das áreas sem arredondar); faixa sobre a nota arredondada.
- `?demo=` só funciona em localhost/127.0.0.1. Teste: `/workspace/diagnostico/.venv/bin/python test_flow.py`.
