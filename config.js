// Configuração do Diagnóstico NexVita — único lugar para editar, sem build.
window.DIAG_CONFIG = {
  // URL do Web App do Google Apps Script (termina em /exec). Vazio = não envia nada.
  ENDPOINT_URL: "https://script.google.com/macros/s/AKfycbw6D8Z0I7VnUUIssbgRHdUfW47rqoSbM8nDPp9Dh-W9g3m8aYI1iMeWpdIAl5hnPVIB/exec",
  // Destino do botão wa.me (o lead clica para falar com o Mori). Não é token nem remetente de API.
  WHATSAPP_NUMBER: "5511936244354",
  // ID do Meta Pixel (só dígitos). Vazio = pixel não carrega.
  META_PIXEL_ID: "1092369830292295",
  // ID do GA4 (G-XXXX). Vazio = sem GA4 / generate_lead.
  GA4_ID: ""
};
