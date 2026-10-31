const status = document.querySelector("#status");
document.querySelector("#diagnose").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith("https://chatgpt.com/")) throw new Error("Chọn tab ChatGPT đã trả lời trước, rồi mở lại tiện ích.");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const describe = el => ({ tag: el.tagName, id: el.id, class: String(el.className).slice(0, 300), role: el.getAttribute('role'), testid: el.getAttribute('data-testid'), author: el.getAttribute('data-message-author-role'), turn: el.getAttribute('data-turn'), label: el.getAttribute('aria-label') });
        const selectors = ['main', '[role="main"]', 'article', '[data-message-author-role="assistant"]', '[data-testid*="conversation-turn"]', '.markdown', '[class*="markdown"]', '.prose', 'iframe'];
        const samples = {};
        for (const selector of selectors) {
          const nodes = [...document.querySelectorAll(selector)];
          samples[selector] = { count: nodes.length, elements: nodes.slice(-4).map(el => ({ ...describe(el), parents: [el.parentElement, el.parentElement?.parentElement].filter(Boolean).map(describe), text: (el.innerText || el.textContent || '').slice(-1800) })) };
        }
        return { url: location.origin + location.pathname, title: document.title, samples, buttons: [...document.querySelectorAll('button')].slice(-35).map(describe), tail: (document.body.innerText || '').slice(-3500), shadowHosts: [...document.querySelectorAll('*')].filter(el => el.shadowRoot).map(describe) };
      },
    });
    const data = JSON.stringify({ version: chrome.runtime.getManifest().version, ...result }, null, 2);
    const box = document.querySelector("#diagnostic"); box.hidden = false; box.value = data;
    const link = document.querySelector("#download-report");
    if (link.href.startsWith('blob:')) URL.revokeObjectURL(link.href);
    link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    link.download = 't12-chatgpt-diagnostic.json'; link.hidden = false;
    status.textContent = "Đã lấy thông tin. Báo cáo có đoạn cuối nội dung trang; kiểm tra trước khi gửi.";
  } catch (error) { status.textContent = error.message; }
});
chrome.storage.local.get(["token", "status"]).then(data => {
  status.textContent = data.status || "Chưa kết nối";
});
chrome.storage.onChanged.addListener(changes => { if (changes.status) status.textContent = changes.status.newValue; });
document.querySelector("#connect").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "connect" });
  if (result?.error) status.textContent = result.error;
});
document.querySelector("#disconnect").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "disconnect" });
  if (result?.error) status.textContent = result.error;
});
