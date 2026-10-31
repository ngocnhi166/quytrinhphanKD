// DOM helpers kept separate so editor discovery can be regression tested.
(() => {
  function roots() {
    const found = [document];
    for (let index = 0; index < found.length; index++) {
      for (const element of found[index].querySelectorAll("*")) {
        if (element.shadowRoot) found.push(element.shadowRoot);
      }
    }
    return found;
  }
  function visible(element) {
    return element && element.isConnected && element.getClientRects().length > 0 &&
      !element.disabled && !element.readOnly && element.getAttribute("aria-hidden") !== "true";
  }
  function find(selectors, predicate = () => true) {
    const scopes = roots();
    for (const selector of selectors) {
      for (const root of scopes) {
        const element = [...root.querySelectorAll(selector)].find(element => visible(element) && predicate(element));
        if (element) return element;
      }
    }
    return null;
  }
  function editor() {
    // #prompt-textarea may be a wrapper rather than the editable node itself.
    const selectors = [
      "#prompt-textarea[contenteditable='true']",
      "#prompt-textarea[contenteditable='plaintext-only']",
      "textarea#prompt-textarea",
      "#prompt-textarea [contenteditable='true']",
      "#prompt-textarea [contenteditable='plaintext-only']",
      ".ProseMirror[contenteditable='true']",
      "[role='textbox'][contenteditable='true']",
      "[role='textbox'][contenteditable='plaintext-only']",
      "form [contenteditable='true']",
      "main [contenteditable='true']",
      "main [contenteditable='plaintext-only']",
      "textarea[placeholder]",
      "[contenteditable='true'][tabindex]",
    ];
    return find(selectors);
  }
  function diagnostic() {
    return `URL: ${location.origin}${location.pathname}; tiêu đề: ${document.title}; ô soạn thảo hiển thị: ${roots().reduce((total, root) => total + [...root.querySelectorAll('textarea,[contenteditable]')].filter(visible).length, 0)}`;
  }
  function normalize(value) {
    return String(value || "").normalize("NFC").replace(/[\u200b\ufeff]/g, "").replace(/\s+/g, " ").trim();
  }
  function hasPrompt(element, prompt) {
    const expected = normalize(prompt);
    return Boolean(expected && [element?.value, element?.innerText, element?.textContent]
      .some(value => normalize(value).includes(expected)));
  }
  function sendButton() {
    return find([
      "button[data-testid='send-button']",
      "button#composer-submit-button",
      "button[data-testid='composer-send-button']",
      "button[aria-label='Send prompt']",
      "button[aria-label='Send message']",
      "button[aria-label='Gửi lời nhắc']",
      "button[aria-label='Gửi tin nhắn']",
      "button[aria-label='Gửi']",
      "form button[type='submit']",
    ], button => button.getAttribute("aria-disabled") !== "true" &&
      !/stop|dừng|voice|giọng nói|dictat|microphone/i.test([
        button.getAttribute("aria-label"), button.getAttribute("data-testid"),
      ].join(" ")));
  }
  function fileInput(filename) {
    const extension = '.' + filename.split('.').pop().toLowerCase();
    const mime = extension === '.csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const inputs = [...document.querySelectorAll("input[type='file']")].filter(el => !el.disabled && el.isConnected);
    return inputs.find(el => (el.getAttribute('accept') || '').toLowerCase().split(',').map(s => s.trim()).some(value => value === extension || value === mime)) ||
      inputs.find(el => !el.getAttribute('accept') || ['*', '*/*'].includes(el.getAttribute('accept').trim())) || null;
  }
  globalThis.T12Composer = { find, editor, diagnostic, hasPrompt, sendButton, fileInput };
})();
