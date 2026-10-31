// Same lifecycle as the reference local_ai_runner.js: owned tab -> inject -> save -> close.
let socket, heartbeat, retry, active;
let enabled = false, generation = 0;
const API = "ws://127.0.0.1:8000/api/bridge";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function status(text) { await chrome.storage.local.set({ status: text }); }
async function connect() {
  if (!enabled) return;
  const attempt = generation;
  if (socket && socket.readyState <= 1) return;
  let token;
  try {
    const response = await fetch("http://127.0.0.1:8000/api/pairing", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Backend chưa sẵn sàng");
    ({ token } = await response.json());
  } catch {
    if (attempt === generation) status("Backend chưa sẵn sàng. Chạy backend rồi bấm Mở tool.");
    return;
  }
  if (!enabled || attempt !== generation) return;
  socket = new WebSocket(`${API}?token=${encodeURIComponent(token)}`);
  const current = socket;
  current.onopen = () => {
    status("Đã kết nối backend");
    heartbeat = setInterval(() => {
      if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: "ping" }));
    }, 20000);
  };
  current.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type === "run") run(msg);
    if (msg.type === "saved" && active?.id === msg.id) finish();
  };
  current.onclose = () => {
    clearInterval(heartbeat);
    status("Đã ngắt kết nối. Bấm Mở tool để kết nối lại.");
    // Interrupt content work before reconnecting, never replay an upload automatically.
    if (active?.tabId) chrome.tabs.sendMessage(active.tabId, { type: "abort" }).catch(() => {});
    active = null;
    clearTimeout(retry);
  };
  current.onerror = () => current.close();
}
async function finish() {
  const job = active;
  active = null;
  if (!job) return;
  // Retain failed tabs for inspection. Success is closed only after backend saved acknowledgement.
  if (!job.failed && job.tabId) await chrome.tabs.remove(job.tabId).catch(() => {});
  if (!job.failed && job.sourceTabId) await chrome.tabs.update(job.sourceTabId, { active: true }).catch(() => {});
  await chrome.storage.session.remove("ownedTab");
  status(job.failed ? "Lượt chạy lỗi — xem chi tiết trên website" : "Đã lưu kết quả • tab đã đóng");
}
async function run(job) {
  if (active) return;
  active = { id: job.id, tabId: null, failed: false };
  const current = active;
  try {
    const [source] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (/^http:\/\/(localhost|127\.0\.0\.1):3000(?:\/|$)/.test(source?.url || "")) current.sourceTabId = source.id;
    const tab = await chrome.tabs.create({ url: "https://chatgpt.com/", active: false });
    current.tabId = tab.id;
    await chrome.storage.session.set({ ownedTab: tab.id });
    status("Đang mở ChatGPT và gửi tệp…");
    const deadline = Date.now() + 60000;
    let loaded = false;
    while (Date.now() < deadline && active === current) {
      const info = await chrome.tabs.get(tab.id);
      if (info.status === "complete" && info.url?.startsWith("https://chatgpt.com/")) { loaded = true; break; }
      await delay(500);
    }
    if (!loaded || active !== current) throw new Error("Không mở được ChatGPT. Kiểm tra đăng nhập và mạng.");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["composer.js", "conversation.js", "report.js", "chatgpt.js"] });
    const response = await chrome.tabs.sendMessage(tab.id, { type: "analyze", job });
    if (active !== current) return;
    if (response?.started) { status("Đã gửi yêu cầu • đang chờ nội dung phản hồi"); return; }
    if (response?.error) throw new Error(response.error);
    if (!response?.text) throw new Error("Không nhận được nội dung phản hồi.");
    socket.send(JSON.stringify({ type: "result", id: job.id, text: response.text }));
    status("Đang lưu kết quả về website…");
  } catch (error) {
    if (active !== current) return;
    current.failed = true;
    status(`Lỗi: ${error.message}`);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "result", id: job.id, error: error.message }));
  }
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === "disconnect") {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    enabled = false; generation++;
    clearTimeout(retry); clearInterval(heartbeat);
    const job = active; active = null;
    const old = socket; socket = null;
    if (old) { old.onclose = null; old.close(); }
    (async () => {
      if (job?.tabId) {
        await chrome.tabs.sendMessage(job.tabId, { type: "abort" }).catch(() => {});
        await chrome.tabs.remove(job.tabId).catch(() => {});
      }
      await chrome.storage.session.remove("ownedTab");
      await status("Tool đã đóng");
      respond({ ok: true });
    })();
    return true;
  }
  if (msg.type === "analysis-result") {
    if (sender.id !== chrome.runtime.id || sender.tab?.id !== active?.tabId || msg.id !== active?.id) return;
    if (socket?.readyState !== WebSocket.OPEN) { respond({ ok: false }); return; }
    active.failed = Boolean(msg.error || msg.html_error);
    socket.send(JSON.stringify({ type: "result", id: msg.id, text: msg.text, html: msg.html, html_error: msg.html_error, error: msg.error }));
    status(msg.error ? `Lỗi: ${msg.error}` : "Đã nhận phản hồi • đang lưu kết quả");
    respond({ ok: true });
    return;
  }
  if (msg.type === "analysis-progress") {
    if (sender.id === chrome.runtime.id && sender.tab?.id === active?.tabId && msg.id === active?.id && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "progress", id: msg.id, text: msg.text }));
    }
    respond({ ok: true });
    return;
  }
  if (msg.type === "connect") {
    // Settings can only be changed from this extension's popup.
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    (async () => {
      if (active) return respond({ ok: false, error: "Đang phân tích, hãy đợi hoàn thành." });
      enabled = true; generation++;
      const old = socket;
      if (old) { old.onclose = null; old.close(); }
      clearInterval(heartbeat);
      socket = null;
      await connect();
      respond({ ok: true });
    })();
    return true;
  }
});
// Remove the old reconnect alarm when upgrading; only the popup can open the tool.
chrome.alarms.clear("reconnect");
status("Tool đang đóng. Bấm Mở tool để sử dụng.");
