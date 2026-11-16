import json, subprocess, time, os
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__))
srv=subprocess.Popen(["python3","-m","http.server","8767"],cwd=HERE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1.5)
EP="http://lead.test/exec"; TRACK=("googletagmanager","google-analytics","doubleclick","googleadservices","facebook","fbcdn")
def run(p,accept,pixel="123456789"):
    b=p.chromium.launch(); pg=b.new_page(); reqs=[]; leads=[]
    pg.on("request",lambda r: reqs.append(r.url))
    pg.route("**/config.js",lambda r:r.fulfill(content_type="application/javascript",body='window.DIAG_CONFIG={ENDPOINT_URL:"%s",WHATSAPP_NUMBER:"5500000000000",META_PIXEL_ID:"%s",GA4_ID:""};'%(EP,pixel)))
    pg.route(EP,lambda r:(leads.append(json.loads(r.request.post_data)),r.fulfill(body='{"status":"ok"}')))
    pg.route("**/*",lambda r: r.fulfill(body="") if any(t in r.request.url for t in TRACK) else r.fallback())
    pg.route(EP,lambda r:(leads.append(json.loads(r.request.post_data)),r.fulfill(body='{"status":"ok"}')))
    pg.goto("http://localhost:8767/?utm_source=google&utm_medium=cpc&utm_campaign=diag&utm_content=v1"); pg.wait_for_selector("#cookie-banner"); pg.wait_for_timeout(800)
    before=[u for u in reqs if any(t in u for t in TRACK)]
    pg.click("#cb-ok" if accept else "#cb-no"); pg.wait_for_timeout(500)
    pg.click("#start")
    for i in range(15): pg.locator(".opt").nth(2).click(); pg.wait_for_timeout(260)
    pg.fill("#nome","Teste"); pg.fill("#clinica","Clinica"); pg.fill("#especialidade","Derma"); pg.type("#whatsapp","11912345678"); pg.check("#lgpd")
    pg.click("#send"); pg.wait_for_selector("#r-wa"); pg.wait_for_timeout(400)
    with pg.context.expect_page(): pg.click("#r-wa")
    dl=pg.evaluate("JSON.stringify((window.dataLayer||[]).map(a=>Array.from(a)))")
    fbq=pg.evaluate("typeof fbq==='function'?(fbq.queue||[]).map(a=>Array.from(a)):null")
    stored=pg.evaluate("localStorage.getItem('nv_consent')")
    pg.reload(); pg.wait_for_selector("#start"); banner_again=pg.locator("#cookie-banner").count()
    after=[u for u in reqs if any(t in u for t in TRACK)]
    b.close()
    return dict(before=before,after=sorted(set(u.split('?')[0] for u in after)),dl=dl,fbq=fbq,stored=stored,banner_again=banner_again,payload_utm={k:v for k,v in leads[0].items() if k.startswith("utm")},payload_consent=leads[0]["consentimento"],fonts_google=any("fonts.g" in u for u in reqs))
def run_click(p,qs,check):
    """gclid/gbraid/wbraid: capturado na URL, sobrevive a recarregar sem o parâmetro (sessionStorage), vai no payload.
    Cookies RECUSADOS: o lead é enviado mesmo assim e nenhuma tag carrega. check=False: sem marcar o consentimento."""
    b=p.chromium.launch(); pg=b.new_page(); reqs=[]; leads=[]
    pg.on("request",lambda r: reqs.append(r.url))
    pg.route("**/config.js",lambda r:r.fulfill(content_type="application/javascript",body='window.DIAG_CONFIG={ENDPOINT_URL:"%s",WHATSAPP_NUMBER:"5500000000000",META_PIXEL_ID:"123456789",GA4_ID:""};'%EP))
    pg.route("**/*",lambda r: r.fulfill(body="") if any(t in r.request.url for t in TRACK) else r.fallback())
    pg.route(EP,lambda r:(leads.append(json.loads(r.request.post_data)),r.fulfill(body='{"status":"ok"}')))
    pg.goto("http://localhost:8767/?"+qs+"&utm_source=google&utm_medium=cpc"); pg.wait_for_selector("#cookie-banner")
    stored_1=pg.evaluate("JSON.parse(sessionStorage.getItem('nv_attr'))")  # gravado antes de qualquer escolha de cookie
    pg.click("#cb-no"); pg.wait_for_timeout(300)
    pg.goto("http://localhost:8767/"); pg.wait_for_selector("#start")   # volta sem parâmetros na mesma aba
    stored_2=pg.evaluate("JSON.parse(sessionStorage.getItem('nv_attr'))")
    pg.click("#start")
    for i in range(15): pg.locator(".opt").nth(1).click(); pg.wait_for_timeout(260)
    pg.fill("#nome","Teste Sintetico"); pg.fill("#clinica","Clinica Sintetica"); pg.fill("#especialidade","Derma"); pg.type("#whatsapp","11912345678")
    if check: pg.check("#lgpd")
    pg.click("#send"); pg.wait_for_selector("#r-wa"); pg.wait_for_timeout(500)
    cookies=pg.context.cookies(); dl=pg.evaluate("JSON.stringify((window.dataLayer||[]).map(a=>Array.from(a)))")
    b.close()
    return dict(stored_1=stored_1,stored_2=stored_2,leads=leads,cookies=[c["name"] for c in cookies],dl=dl,
      tags=[u for u in reqs if any(t in u for t in TRACK)])
with sync_playwright() as p:
    A=run(p,True); R=run(p,False); E=run(p,True,pixel="")
    G=run_click(p,"gclid=TEST-gclid_sintetico123",False); W=run_click(p,"gbraid=TESTgbraid0001&wbraid=TESTwbraid0002",True)
    for n,x in (("GCLID_sem_checkbox_cookies_recusados",G),("GBRAID_WBRAID_com_checkbox",W)): print("==",n); print(json.dumps(x,ensure_ascii=False,indent=1)[:2500])
    assert G["stored_1"]["gclid"]=="TEST-gclid_sintetico123" and G["stored_2"]["gclid"]=="TEST-gclid_sintetico123" and G["stored_2"]["utm_source"]=="google"
    assert len(G["leads"])==1 and G["leads"][0]["gclid"]=="TEST-gclid_sintetico123" and G["leads"][0]["gbraid"]=="" and G["leads"][0]["wbraid"]==""
    assert G["leads"][0]["consentimento"] is False and G["leads"][0]["utm_source"]=="google" and G["leads"][0]["utm_medium"]=="cpc"
    assert G["tags"]==[] and G["cookies"]==[] and "jZSiCK-4rrEdEPqOvapD" not in G["dl"]  # cookies recusados: lead vai, tag não
    assert len(W["leads"])==1 and W["leads"][0]["consentimento"] is True
    assert (W["leads"][0]["gclid"],W["leads"][0]["gbraid"],W["leads"][0]["wbraid"])==("","TESTgbraid0001","TESTwbraid0002")
    for n,x in (("ACEITAR",A),("RECUSAR",R),("ACEITAR_sem_pixel",E)): print("==",n); print(json.dumps(x,ensure_ascii=False,indent=1)[:2500])
    assert A["before"]==[] and R["before"]==[] and R["after"]==[] and R["fbq"] is None
    assert "jZSiCK-4rrEdEPqOvapD" in A["dl"] and "generate_lead" not in A["dl"]
    assert [q[:2] for q in A["fbq"]]==[["init","123456789"],["track","PageView"],["track","Lead"],["track","Contact"]]
    assert E["fbq"] is None and not any("facebook" in u for u in E["after"])
    assert A["stored"]=="granted" and R["stored"]=="denied" and A["banner_again"]==0==R["banner_again"]
    assert A["payload_consent"] is True and R["payload_consent"] is True
    assert A["payload_utm"]=={"utm_source":"google","utm_campaign":"diag","utm_medium":"cpc","utm_content":"v1"}
    print("TODOS OS ASSERTS OK")
srv.terminate()
