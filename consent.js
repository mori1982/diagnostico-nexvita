/* Consentimento LGPD + tags (Google Ads / GA4 / Meta Pixel). Nada de terceiros carrega antes do "Aceitar". */
"use strict";
(function () {
  var C = window.DIAG_CONFIG || {}, KEY = "nv_consent", AW = "AW-18074257274";
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
  var loaded = false;
  function load() {
    if (loaded) return; loaded = true;
    gtag("consent", "update", { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted" });
    var s = document.createElement("script"); s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + AW;
    document.head.appendChild(s);
    gtag("js", new Date()); gtag("config", AW);
    if (C.GA4_ID) gtag("config", C.GA4_ID);
    if (C.META_PIXEL_ID) {
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;
      s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq("init", C.META_PIXEL_ID); fbq("track", "PageView");
    }
  }
  var granted = function () { return loaded; };
  /* API usada pelo app.js — tudo no-op sem consentimento */
  window.NVTrack = {
    lead: function () {
      if (!granted()) return;
      if (typeof gtag === "function") {
        gtag("event", "conversion", { send_to: "AW-18074257274/jZSiCK-4rrEdEPqOvapD" });
        if (C.GA4_ID) gtag("event", "generate_lead");
      }
      if (typeof fbq === "function") fbq("track", "Lead");
    },
    contact: function () { if (granted() && typeof fbq === "function") fbq("track", "Contact"); }
  };
  var choice = null; try { choice = localStorage.getItem(KEY); } catch (e) {}
  if (choice === "granted") { load(); return; }
  if (choice === "denied") return;
  function banner() {
    var d = document.createElement("div"); d.id = "cookie-banner"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "Cookies");
    d.innerHTML = '<p>Usamos cookies para medir nossas campanhas (Google Ads e Meta). Você escolhe. <a href="privacidade.html">Política de Privacidade</a></p>' +
      '<div class="cb-btns"><button type="button" class="btn cb-no" id="cb-no">Recusar</button><button type="button" class="btn btn-primary cb-ok" id="cb-ok">Aceitar</button></div>';
    document.body.appendChild(d);
    function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} d.remove(); if (v === "granted") load(); }
    d.querySelector("#cb-ok").onclick = function () { set("granted"); };
    d.querySelector("#cb-no").onclick = function () { set("denied"); };
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", banner) : banner();
})();
