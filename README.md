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
  "scoring": { "maxPerQuestion": 4, "insightThresholds": { "mid": 40, "high": 80 } },
  "areas":    [{ "id": "atendimento", "name": "Atendimento e experiência do paciente",
                 "insights": { "low": "...", "mid": "...", "high": "..." } }],
  "questions":[{ "id": "q1", "area": "atendimento", "text": "...?",
                 "options": [{ "label": "Mais de um dia", "points": 0 }, ...] }],
  "levels":   [{ "min": 0, "max": 39, "label": "Operação no limite", "description": "..." }],
  "invite":   { "text": "Sua clínica tirou [NOTA]. ...", "signature": "Mori, NexVita",
                "button": "Quero conversar com o Mori",
                "whatsappMessage": "Oi Mori, ... tirou [NOTA]. ..." }
}
```
Regras: nota da área = soma dos pontos / (nº de perguntas da área × `maxPerQuestion`) × 100; nota geral = média das áreas (arredondada). Insight: `< mid` → low, `< high` → mid, senão high. No JSON atual, `high` é 80. `[NOTA]` é substituído pela nota geral. O número do botão não está neste JSON: fica em `config.js` (`WHATSAPP_NUMBER`) e só monta o link `wa.me`.

## Envio do lead

`submitLead` em `app.js` faz POST `text/plain` com `no-cors` para `ENDPOINT_URL` em `config.js`. URL vazia não envia. Há um retry de rede após 3 s, com o mesmo payload. A tela de resultado aparece mesmo se o POST falhar; a falha fica em `console.warn`.

O corpo é plano, no formato de `apps-script/Code.gs`: `q1`..`q15` com A–D, `nota_*`, `faixa`, `utm_*`, `origem` (`?src=`), `referrer` e `website` (honeypot). `whatsapp` é o telefone que o lead digitou (10 ou 11 dígitos). Não é status de entrega.

O botão do resultado abre `https://wa.me/` com o número de `WHATSAPP_NUMBER`. É um clique do lead. A página não chama API de WhatsApp.

## Card compartilhável
Gerado em `<canvas>` puro (`makeCard("feed"|"story")` em `app.js`), 1080×1350 e 1080×1920, com o logo `assets/nexvita-papel.png`, Hedvig e Inter. `downloadCard()` usa o Web Share API com arquivo no celular (abre "Salvar imagem"/Instagram) e cai para download de PNG no desktop. Tudo client-side; não precisa de servidor nem de html-to-image. Se o logo for servido de outro domínio, precisa de CORS, senão o canvas fica "tainted" e o download falha.

## Previews / QA
`?demo=intro|question|contact|result|feed|story` renderiza cada tela com respostas de exemplo (usado para gerar `preview/`). Só funciona em `localhost` e `127.0.0.1`.

## Apps Script e WhatsApp

`apps-script/Code.gs` valida o POST, acrescenta a linha na aba `Leads` e manda e-mail para `mori@nexvita.com`. O e-mail traz um link `wa.me` manual. Não há `UrlFetchApp` nem provedor de WhatsApp.

Sem a propriedade de script `WHATSAPP_PROVIDER`, a linha nova recebe `wa_disposition=provider_unconfigured` e `wa_attempt=0`. Qualquer valor nessa propriedade, inclusive `mock`, fica `provider_rejected`: nenhum adaptador está implementado, e o `doPost` não aceita recibo vindo do navegador. Segredo não entra no repositório. A chave `wa_idempotency_key` é o SHA-256 de `timestamp|telefone`; o retry do mesmo payload não grava outra linha nem manda outro e-mail. Falha de e-mail não apaga a linha.

`accepted`, `sent`, `delivered` e `failed` são classificações de um recibo mock nos testes. Este runtime não as grava e não cria `message_id`.

Publicar isso é manual: colar `Code.gs` no projeto Apps Script dono da implantação e gerar uma versão nova. A URL `/exec` não é o ID do script. Este repositório não publica nem envia mensagem.

## Testes

- `node test_whatsapp_handoff.js` — disposição, dedupe, recibo mock e a garantia de que `doPost` não dispara WhatsApp.
- Fluxo da página, com Playwright instalado: `python3 test_flow.py` e `python3 test_tracking.py`.

## Pendências fora deste código

- Provedor oficial de WhatsApp (Cloud API ou BSP), credencial fora do git e um número de teste aprovado pelo Mori. Sem isso não há envio nem recibo.
- Acesso de edição ao projeto Apps Script (ID do script e conta dona) para comparar o código implantado com este arquivo antes de publicar.
- Textos da Virginia em `questions.json` seguem marcados como rascunho.
