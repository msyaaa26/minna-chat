// AIチャット。Cloudflare Workers + Workers AI + D1。ログイン機能なし。
// 必要な設定: D1 を変数名 DB、Workers AI を変数名 AI でバインドする。
// 利用者の識別: ブラウザが作る ID(uid)を localStorage に保存して使う。

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const SYSTEM = "あなたは親切で丁寧なAIアシスタントです。特に指定がなければ日本語で答えてください。";
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_MESSAGE = 2000;
const CONTEXT_LIMIT = 20;

const PAGE = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AIチャット</title>
<style>
  :root { --bg:#f6f7f9; --fg:#1b1f24; --card:#fff; --accent:#2563eb; --muted:#6b7280; --line:#e5e7eb; --me:#dbeafe; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --fg:#e8eaed; --card:#181b21; --accent:#60a5fa; --muted:#9aa0a6; --line:#2a2f38; --me:#1e3a5f; }
  }
  * { box-sizing: border-box; }
  html, body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family:-apple-system,"Hiragino Sans",sans-serif; display:flex; flex-direction:column; }
  header { display:flex; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line); background:var(--card); align-items:center; }
  header h1 { font-size:16px; margin:0; flex:0 0 auto; }
  select, button, textarea { font:inherit; color:var(--fg); }
  select { flex:1; min-width:0; padding:8px; border-radius:8px; border:1px solid var(--line); background:var(--bg); }
  button { padding:8px 12px; border-radius:8px; border:1px solid var(--line); background:var(--card); cursor:pointer; }
  button.main { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  button:disabled { opacity:.5; cursor:default; }
  #log { flex:1; overflow:auto; padding:16px 12px; max-width:760px; width:100%; margin:0 auto; }
  .msg { max-width:85%; padding:10px 12px; border-radius:12px; margin:0 0 10px; white-space:pre-wrap; word-break:break-word; line-height:1.55; }
  .user { margin-left:auto; background:var(--me); }
  .assistant { background:var(--card); border:1px solid var(--line); }
  .note { color:var(--muted); text-align:center; font-size:13px; margin:12px 0; }
  form { display:flex; gap:8px; padding:10px 12px; border-top:1px solid var(--line); background:var(--card); max-width:760px; width:100%; margin:0 auto; }
  textarea { flex:1; resize:none; padding:10px; border-radius:8px; border:1px solid var(--line); background:var(--bg); min-height:44px; max-height:140px; }
</style>
</head>
<body>
<header>
  <h1>AIチャット</h1>
  <select id="convs" aria-label="会話の履歴"></select>
  <button id="new" type="button">新しい会話</button>
  <button id="del" type="button">削除</button>
</header>
<div id="log"></div>
<form id="f">
  <textarea id="m" rows="1" maxlength="2000" placeholder="メッセージを入力(Enterで改行、送信ボタンで送信)" required></textarea>
  <button class="main" id="send" type="submit">送信</button>
</form>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var log = $("log"), sel = $("convs"), box = $("m"), sendBtn = $("send");
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, function () { return Math.floor(Math.random() * 16).toString(16); });
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  var uid = store("uid") || uuid(); store("uid", uid);
  var cid = store("cid") || uuid();
  var busy = false;

  function api(path, opts) {
    return fetch(path, opts).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "エラーが発生しました"); return j; }); });
  }
  function add(role, text) {
    var d = document.createElement("div"); d.className = "msg " + role; d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  function note(text) {
    var d = document.createElement("div"); d.className = "note"; d.textContent = text; log.appendChild(d);
  }
  function setCid(id) { cid = id; store("cid", cid); }

  function loadList() {
    return api("/api/conversations?uid=" + uid).then(function (list) {
      sel.textContent = "";
      var found = false;
      list.forEach(function (c) {
        var o = document.createElement("option"); o.value = c.id; o.textContent = c.title; sel.appendChild(o);
        if (c.id === cid) found = true;
      });
      if (!found) { var o = document.createElement("option"); o.value = cid; o.textContent = "(新しい会話)"; sel.insertBefore(o, sel.firstChild); }
      sel.value = cid;
    });
  }
  function loadMessages() {
    log.textContent = "";
    return api("/api/messages?uid=" + uid + "&cid=" + cid).then(function (list) {
      if (!list.length) note("メッセージを送ると、会話がここに残ります。");
      list.forEach(function (m) { add(m.role, m.content); });
    }).catch(function (e) { note(e.message); });
  }
  sel.addEventListener("change", function () { setCid(sel.value); loadMessages(); });
  $("new").addEventListener("click", function () { setCid(uuid()); loadList().then(loadMessages); });
  $("del").addEventListener("click", function () {
    if (!confirm("この会話を削除しますか?")) return;
    api("/api/conversations?uid=" + uid + "&cid=" + cid, { method: "DELETE" }).then(function () {
      setCid(uuid()); return loadList();
    }).then(loadMessages).catch(function (e) { note(e.message); });
  });
  $("f").addEventListener("submit", function (e) {
    e.preventDefault();
    var text = box.value.trim(); if (!text || busy) return;
    busy = true; sendBtn.disabled = true; box.value = "";
    var first = log.querySelector(".note"); if (first) first.remove();
    add("user", text);
    var wait = add("assistant", "考え中…");
    api("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uid: uid, cid: cid, message: text }) })
      .then(function (j) { wait.textContent = j.reply; log.scrollTop = log.scrollHeight; return loadList(); })
      .catch(function (err) { wait.textContent = "エラー: " + err.message; })
      .then(function () { busy = false; sendBtn.disabled = false; box.focus(); });
  });
  loadList().then(loadMessages).catch(function (e) { note(e.message); });
})();
</script>
</body>
</html>`;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function ensureTables(db) {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, uid TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL)"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)"
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conv_id, id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_conversations_uid ON conversations (uid, created_at)"),
  ]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/") {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (!path.startsWith("/api/")) return new Response("Not Found", { status: 404 });

    if (!env.DB) return json({ error: "データベース(DB)が設定されていません。" }, 500);
    await ensureTables(env.DB);

    const uid = url.searchParams.get("uid");
    const cid = url.searchParams.get("cid");

    // 会話の一覧
    if (path === "/api/conversations" && request.method === "GET") {
      if (!ID_RE.test(uid || "")) return json({ error: "不正なIDです。" }, 400);
      const { results } = await env.DB
        .prepare("SELECT id, title FROM conversations WHERE uid = ? ORDER BY created_at DESC LIMIT 50")
        .bind(uid)
        .all();
      return json(results);
    }

    // 会話の削除
    if (path === "/api/conversations" && request.method === "DELETE") {
      if (!ID_RE.test(uid || "") || !ID_RE.test(cid || "")) return json({ error: "不正なIDです。" }, 400);
      const owned = await env.DB
        .prepare("SELECT 1 FROM conversations WHERE id = ? AND uid = ?")
        .bind(cid, uid)
        .first();
      if (owned) {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM messages WHERE conv_id = ?").bind(cid),
          env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(cid),
        ]);
      }
      return json({ ok: true });
    }

    // 会話の中身
    if (path === "/api/messages" && request.method === "GET") {
      if (!ID_RE.test(uid || "") || !ID_RE.test(cid || "")) return json({ error: "不正なIDです。" }, 400);
      const owned = await env.DB
        .prepare("SELECT 1 FROM conversations WHERE id = ? AND uid = ?")
        .bind(cid, uid)
        .first();
      if (!owned) return json([]);
      const { results } = await env.DB
        .prepare("SELECT role, content FROM messages WHERE conv_id = ? ORDER BY id ASC LIMIT 500")
        .bind(cid)
        .all();
      return json(results);
    }

    // 送信
    if (path === "/api/chat" && request.method === "POST") {
      let data;
      try { data = await request.json(); } catch { return json({ error: "不正なデータです。" }, 400); }
      if (!ID_RE.test(String(data.uid || "")) || !ID_RE.test(String(data.cid || ""))) {
        return json({ error: "不正なIDです。" }, 400);
      }
      const message = String(data.message || "").trim().slice(0, MAX_MESSAGE);
      if (!message) return json({ error: "メッセージが空です。" }, 400);
      if (!env.AI) return json({ error: "Workers AI(AI)が設定されていません。" }, 500);

      const now = Math.floor(Date.now() / 1000);
      const existing = await env.DB
        .prepare("SELECT uid FROM conversations WHERE id = ?")
        .bind(data.cid)
        .first();
      if (existing && existing.uid !== data.uid) return json({ error: "この会話は使えません。" }, 403);
      if (!existing) {
        await env.DB
          .prepare("INSERT INTO conversations (id, uid, title, created_at) VALUES (?, ?, ?, ?)")
          .bind(data.cid, data.uid, message.slice(0, 30), now)
          .run();
      }
      await env.DB
        .prepare("INSERT INTO messages (conv_id, role, content, created_at) VALUES (?, 'user', ?, ?)")
        .bind(data.cid, message, now)
        .run();

      const { results } = await env.DB
        .prepare("SELECT role, content FROM messages WHERE conv_id = ? ORDER BY id DESC LIMIT ?")
        .bind(data.cid, CONTEXT_LIMIT)
        .all();
      const history = results.reverse();

      let reply;
      try {
        const out = await env.AI.run(MODEL, {
          messages: [{ role: "system", content: SYSTEM }, ...history],
          max_tokens: 1024,
        });
        reply = String((out && out.response) || "").trim();
      } catch (err) {
        return json({ error: "AIの呼び出しに失敗しました。少し待ってからもう一度お試しください。" }, 502);
      }
      if (!reply) return json({ error: "AIから返事がありませんでした。" }, 502);

      await env.DB
        .prepare("INSERT INTO messages (conv_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)")
        .bind(data.cid, reply, Math.floor(Date.now() / 1000))
        .run();
      return json({ reply });
    }

    return json({ error: "Not Found" }, 404);
  },
};
