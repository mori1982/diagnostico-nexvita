import json, subprocess, time, os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
srv = subprocess.Popen(["python3","-m","http.server","8766"], cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
EP = "http://lead.test/exec"
def run(p, choice, prefix, fail=False):
    b = p.chromium.launch(); pg = b.new_page(viewport={"width":390,"height":844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    got = []
    pg.route("**/config.js", lambda r: r.fulfill(content_type="application/javascript",
        body='window.DIAG_CONFIG={ENDPOINT_URL:"%s",WHATSAPP_NUMBER:"5500000000000"};' % EP))
    def lead(r):
        got.append(json.loads(r.request.post_data)); r.abort() if fail else r.fulfill(body='{"status":"ok"}')
    pg.route(EP, lead)
    pg.goto("http://localhost:8766/?src=instagram&utm_source=ig&utm_campaign=plano"); pg.wait_for_selector("#start")
    shot = lambda n: prefix and pg.screenshot(path=f"preview/final-{prefix}-{n}.png")
    shot("1-intro"); pg.click("#start")
    pg.locator(".opt").nth(0).click(); pg.wait_for_timeout(350); pg.click("#back"); pg.wait_for_timeout(100)
    assert "1 de 15" in pg.text_content(".prog-row")
    for i in range(15):
        if i == 3: shot("2-pergunta")
        pg.locator(".opt").nth(choice).click(); pg.wait_for_timeout(300)
    pg.wait_for_selector("#f")
    pg.fill("#nome","Ana Teste"); pg.fill("#clinica","Clínica Sintética"); pg.fill("#especialidade","Dermatologia")
    pg.type("#whatsapp","119123"); short=pg.input_value("#whatsapp"); pg.click("#send")
    inv_short = pg.locator(".field.invalid #whatsapp").count()==1
    pg.fill("#whatsapp",""); pg.type("#whatsapp","11912345678"); mask = pg.input_value("#whatsapp")
    pg.click("#send"); err_consent = pg.text_content("#ferr")
    pg.check("#lgpd"); shot("3-contato"); t0=time.time(); pg.click("#send")
    pg.wait_for_selector("#r-areas"); t_result = round(time.time()-t0,2)
    pg.wait_for_timeout(4500 if fail else 500)  # deixa o retry acontecer
    shot("4-resultado")
    res = {"mascara":mask, "curto_invalido":inv_short, "mascara_curta":short, "erro_sem_consent":err_consent,
      "tempo_ate_resultado_s":t_result, "geral":pg.text_content(".ring .val b"), "faixa":pg.text_content(".badge"),
      "areas":{e.get_attribute("data-area"):(e.get_attribute("data-score"),e.get_attribute("data-band")) for e in pg.locator("#r-areas > div").all()},
      "wa":pg.get_attribute("#r-wa","href"), "tentativas_envio":len(got), "payload":got[0] if got else None}
    # honeypot + demo fora de localhost
    b.close(); return res
with sync_playwright() as p:
    out = {}
    for name,c,pre,f in [("maximo",3,"maximo",False),("minimo_envio_falha",0,"minimo",True),("tudo_C",2,"c",False)]:
        out[name]=run(p,c,pre,f); print("==",name); print(json.dumps(out[name],ensure_ascii=False,indent=1))
    M,m,C=out["maximo"],out["minimo_envio_falha"],out["tudo_C"]
    assert M["geral"]=="100" and M["faixa"]=="Alta performance" and all(v==("100","high") for v in M["areas"].values())
    assert m["geral"]=="0" and m["faixa"]=="Operação no limite" and all(v==("0","low") for v in m["areas"].values()) and m["tentativas_envio"]==2
    assert C["geral"]=="75" and C["faixa"]=="Gestão em evolução" and all(v==("75","mid") for v in C["areas"].values())
    assert M["payload"]["q1"]=="D" and M["payload"]["origem"]=="instagram" and M["payload"]["utm_source"]=="ig" and M["payload"]["whatsapp"]=="11912345678" and M["payload"]["website"]==""
    # ENDPOINT vazio: nada enviado; demo só em localhost
    b=p.chromium.launch(); pg=b.new_page(); sent=[]
    pg.on("request", lambda r: r.method=="POST" and sent.append(r.url))
    pg.goto("http://127.0.0.1:8766/?demo=result"); pg.wait_for_selector(".ring"); demo_local=True
    pg.goto("http://0.0.0.0:8766/?demo=result"); pg.wait_for_selector("#start"); demo_off = pg.locator(".ring").count()==0
    b.close(); print("demo local ok:",demo_local,"| demo desligado fora de localhost:",demo_off)
    assert demo_off
    print("TODOS OS ASSERTS OK")
srv.terminate()
