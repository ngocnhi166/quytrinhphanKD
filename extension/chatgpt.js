(() => {
  if (globalThis.__t12Bridge) return;
  globalThis.__t12Bridge = true;
  let aborted = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const find = selectors => globalThis.T12Composer.find(selectors);
  async function wait(check, timeout, message) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (aborted) throw new Error("Đã dừng do mất kết nối backend.");
      const value = check();
      if (value) return value;
      await sleep(500);
    }
    throw new Error(`${message} (${globalThis.T12Composer.diagnostic()})`);
  }
  const stopping = () => globalThis.T12Conversation.busy();
  async function analyze(job) {
    await wait(() => globalThis.T12Composer.editor(), 90000, "Chưa nhận diện được ô soạn thảo. Nếu tab có ô nhập, gửi lại thông tin chẩn đoán bên dưới để cập nhật extension. Nếu tab yêu cầu đăng nhập/CAPTCHA, hoàn tất thủ công rồi tạo lượt mới.");
    // Attach the ORIGINAL file, rather than paste a truncated table into the prompt.
    if (job.file) {
    let upload = globalThis.T12Composer.fileInput(job.filename);
    if (!upload) {
      const attach = find(["button[data-testid='composer-plus-btn']", "button[aria-label='Thêm tệp và nội dung khác']", "button[aria-label='Add files and more']", "button[aria-label='Attach files']"]);
      attach?.click();
      await sleep(500);
      const item = [...document.querySelectorAll("[role='menuitem']")].find(el => /upload from computer|tải lên từ máy|add photos|thêm ảnh|tải tệp|upload files/i.test(el.textContent));
      item?.click();
      upload = await wait(() => globalThis.T12Composer.fileInput(job.filename), 15000, "Không tìm thấy ô tải CSV/XLSX phù hợp. Kiểm tra menu đính kèm của ChatGPT.");
    }
    const bytes = Uint8Array.from(atob(job.file), c => c.charCodeAt(0));
    const mime = job.filename.toLowerCase().endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], job.filename, { type: mime }));
    upload.files = transfer.files;
    upload.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    upload.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await wait(() => document.body.innerText.includes(job.filename) || [...document.querySelectorAll('[title],[aria-label]')].some(el => [el.getAttribute('title'), el.getAttribute('aria-label')].includes(job.filename)), 90000, "ChatGPT chưa hiển thị tệp đính kèm. Kiểm tra thông báo tải tệp trên tab đang mở.");
    }
    // Attaching a file can remount the composer; never type into the old detached node.
    const input = await wait(() => globalThis.T12Composer.editor(), 30000, "Ô nhập chưa sẵn sàng sau khi đính kèm tệp.");
    input.focus();
    if (input instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, job.prompt);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertText", false, job.prompt);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: job.prompt }));
    }
    await wait(() => {
      const current = globalThis.T12Composer.editor();
      return globalThis.T12Composer.hasPrompt(current, job.prompt);
    }, 10000, "Không điền được câu hỏi vào ô nhập. Chưa gửi yêu cầu để tránh gửi thiếu nội dung.");
    // Await upload completion: send remains disabled while attachments are being processed.
    await sleep(2000);
    const send = await wait(() => {
      return !stopping() && globalThis.T12Composer.sendButton();
    }, 90000, "Không gửi được tệp. Kiểm tra giới hạn tải tệp, gói tài khoản hoặc lỗi trên tab ChatGPT.");
    const conversation = globalThis.T12Conversation;
    const before = conversation.snapshot();
    const initialURL = location.href;
    send.click();
    // Confirm submission, but never automatically click again: that could duplicate a request.
    await wait(() => conversation.submitted(before, initialURL, globalThis.T12Composer.editor()),
    90000, "Đã bấm gửi nhưng chưa thấy ChatGPT nhận yêu cầu. Kiểm tra thông báo trên tab; extension không tự gửi lại để tránh trùng.");
    let lastText = "", stableSince = Date.now(), lastProgress = 0, published = "";
    return await wait(() => {
      const last = conversation.latest(before);
      if (!last) return null;
      const text = conversation.text(last);
      // Publish partial text without declaring completion or closing the tab.
      if (text && text !== published && Date.now() - lastProgress > 1500) {
        lastProgress = Date.now(); published = text;
        chrome.runtime.sendMessage({ type: "analysis-progress", id: job.id, text }).catch(() => {});
      }
      if (text !== lastText || stopping()) { lastText = text; stableSince = Date.now(); return null; }
      const turn = last.closest("article,[data-testid^='conversation-turn']") || last;
      if (text && conversation.completed(turn) && Date.now() - stableSince > 2000) return { text, html: globalThis.T12Report.capture(last) };
      // Quick questions have no file/tool workflow. Accept a new stable reply even
      // if the UI no longer exposes the response footer, while retaining tool safeguards for analysis.
      if (job.mode === "simple" && text && !stopping() && Date.now() - stableSince > 8000 &&
          !turn.querySelector("[aria-busy='true'],[data-is-streaming='true']")) return { text, html: globalThis.T12Report.capture(last) };
      return null;
    }, job.mode === "simple" ? 120000 : 720000, "Chưa xác nhận được ChatGPT trả lời xong. Tab được giữ lại để kiểm tra.");
  }
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === "abort") { aborted = true; return; }
    if (msg.type !== "analyze") return;
    aborted = false;
    // Acknowledge immediately; long-lived sendMessage response channels can close
    // on navigation while ChatGPT is still writing. Publish results separately.
    respond({ started: true });
    analyze(msg.job).then(result => chrome.runtime.sendMessage({ type: "analysis-result", id: msg.job.id, text: result.text, html: result.html, html_error: globalThis.T12Report.lastError }))
      .catch(error => chrome.runtime.sendMessage({ type: "analysis-result", id: msg.job.id, error: error.message }))
      .catch(error => console.error("[T12] Không gửi được kết quả", error));
    return false;
  });
})();
