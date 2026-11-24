// Two-device sync E2E for moto.zxyframe.ca: two headless Chromes (device A, device B), each with a fresh profile, over CDP.
// Usage: MOTO_TEST_EMAIL=… MOTO_TEST_PASS=… node test/sync-e2e.mjs <baseUrl>   (Node 26: built-in fetch + WebSocket, no npm installs)
// Prints PASS/FAIL per step, exits 1 on any FAIL. The Supabase URL and anon key are read from the served page (one home: index.html).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = process.argv[2], EMAIL = process.env.MOTO_TEST_EMAIL, PASS = process.env.MOTO_TEST_PASS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const step = (n, ok, why) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${why ? ": " + why : ""}`); return ok; };
const devices = [];

async function launch(name) {
  const port = 9300 + Math.floor(Math.random() * 600), prof = mkdtempSync(join(tmpdir(), `moto-e2e-${name}-`));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
  const dev = { name, proc, prof, exceptions: [], ws: null };
  devices.push(dev);
  let wsUrl;
  for (let i = 0; i < 50 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(200); } }
  if (!wsUrl) throw new Error(`device ${name}: chrome did not start`);
  dev.ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { dev.ws.addEventListener("open", r); dev.ws.addEventListener("error", j); });
  let id = 0; const pending = new Map();
  dev.ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === "Runtime.exceptionThrown") { dev.exceptions.push(d.params.exceptionDetails); console.log(`  [${name}] uncaught: ${(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || "").slice(0, 300)}`); }
    if (d.method === "Runtime.consoleAPICalled") { const t = d.params.args.map((a) => a.value ?? a.description ?? "").join(" "); if (t.includes("[moto6r]")) console.log(`  [${name}] ${d.params.type}: ${t.slice(0, 300)}`); }
  });
  const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pending.set(i, res); dev.ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
  dev.S = (m, p) => send(m, p, sessionId);
  await dev.S("Runtime.enable"); await dev.S("Page.enable");
  dev.ev = async (expr) => { const r = await dev.S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? undefined : r.result?.result?.value; };
  dev.waitFor = async (expr, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await dev.ev(expr)) === true) return true; await sleep(250); } return false; };
  await dev.S("Page.navigate", { url: base });
  return dev;
}

const VISIBLE = (id) => `(e => !!e && !e.hidden && getComputedStyle(e).display !== 'none')(document.getElementById('${id}'))`;
const SIGNED_IN = `${VISIBLE("app")} && !${VISIBLE("auth")}`;
const CLEAN = `(() => { try { return JSON.parse(localStorage['moto6r.sync.v1']).dirty === false; } catch (e) { return false; } })()`;
async function signIn(dev) {
  await dev.ev(`document.getElementById('auth-email').value = ${JSON.stringify(EMAIL)}; document.getElementById('auth-pass').value = ${JSON.stringify(PASS)}; document.getElementById('auth-form').requestSubmit(); true`);
  return dev.waitFor(SIGNED_IN, 15000);
}

try {
  if (!base || !EMAIL || !PASS) throw new Error("usage: MOTO_TEST_EMAIL=… MOTO_TEST_PASS=… node test/sync-e2e.mjs <baseUrl>");
  const html = await (await fetch(base)).text();
  const SB_URL = (html.match(/SB_URL = '([^']+)'/) || [])[1], SB_KEY = (html.match(/SB_KEY = '([^']+)'/) || [])[1];
  if (!SB_URL || !SB_KEY) throw new Error("SB_URL / SB_KEY not found in the served page");

  const A = await launch("A");
  step("1 A: sign-in screen shown, app hidden", await A.waitFor(`${VISIBLE("auth")} && !${VISIBLE("app")}`, 15000), "#auth not visible or #app visible after 15 s");
  step("2 A: sign in shows the app", await signIn(A), `after 15 s: auth err "${await A.ev("document.getElementById('auth-err').textContent")}"`);
  await A.waitFor("document.getElementById('app').childElementCount > 0", 10000); // #app renders only after Store.load(), so S is the loaded state, not DEF()
  const x0 = await A.ev("__app.S.xp");
  await A.ev("__app.S.xp += 7; Store.save(__app.S); true");
  step("3 A: save syncs (dirty false)", await A.waitFor(`__app.S.xp === ${x0 + 7} && ${CLEAN}`, 10000), `x0=${x0}, sync meta ${await A.ev("localStorage['moto6r.sync.v1']")}`);

  const B = await launch("B");
  await B.waitFor(VISIBLE("auth"), 15000);
  const bIn = await signIn(B);
  step("4 B: signs in and sees A's change", bIn && (await B.waitFor(`__app.S.xp === ${x0 + 7}`, 15000)), `signed in ${bIn}, B xp ${await B.ev("__app.S.xp")}, want ${x0 + 7}`);
  await B.ev("__app.S.xp += 5; Store.save(__app.S); true");
  step("5 B: save syncs (dirty false)", await B.waitFor(`__app.S.xp === ${x0 + 12} && ${CLEAN}`, 10000), `sync meta ${await B.ev("localStorage['moto6r.sync.v1']")}`);

  await A.ev("document.dispatchEvent(new Event('visibilitychange')); true");
  step("6 A: visibilitychange pulls B's change", await A.waitFor(`__app.S.xp === ${x0 + 12}`, 10000), `A xp ${await A.ev("__app.S.xp")}, want ${x0 + 12}, document.hidden ${await A.ev("document.hidden")}`);
  step("7 A: 16 book crops loaded, bookCrops on", await A.waitFor("Object.keys(window.CROPIMG).length === 16 && window.CONFIG.bookCrops === true", 10000), `crops ${await A.ev("Object.keys(window.CROPIMG).length")}, bookCrops ${await A.ev("window.CONFIG.bookCrops")}`);

  for (const path of ["moto_assets?select=key", "moto_progress?select=user_id"]) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    const body = await r.text();
    let empty = false; try { empty = Array.isArray(JSON.parse(body)) && JSON.parse(body).length === 0; } catch (e) { console.warn(`  ${path}: body is not JSON`, e.message); }
    step(`8 no session: ${path} returns no data`, (r.status === 200 && empty) || [401, 403, 404].includes(r.status), `status ${r.status}, body ${body.slice(0, 200)}`);
  }
  step("9 no uncaught exceptions on A or B", devices.every((d) => d.exceptions.length === 0), devices.map((d) => `${d.name}: ${d.exceptions.length}`).join(", "));
} catch (e) {
  step("run", false, e.message);
} finally {
  for (const d of devices) {
    try { d.ws && d.ws.close(); } catch (e) { console.warn(`  [${d.name}] ws close failed`, e.message); }
    await new Promise((r) => { d.proc.once("exit", r); d.proc.kill(); setTimeout(r, 3000); });
    rmSync(d.prof, { recursive: true, force: true });
  }
  console.log(failed ? `${failed} step(s) failed` : "all steps passed");
  process.exitCode = failed ? 1 : 0;
}
