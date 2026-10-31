(() => {
  const labeledSurfaces = new WeakSet();
  const textOf = node => (node?.innerText || node?.textContent || "").trim();
  function labeledReply(value) {
    const parts = value.split(/(?:^|\n)\s*(?:ChatGPT đã nói|ChatGPT said)\s*:\s*/i);
    if (parts.length < 2) return "";
    const tail = parts.at(-1);
    // A later user message means this is an old reply, not the new response.
    if (/(?:^|\n)\s*(?:Bạn đã nói|You said)\s*:/i.test(tail)) return "";
    return tail.split(/(?:^|\n)\s*(?:ChatGPT có thể mắc lỗi\.|ChatGPT can make mistakes\.|Phản hồi mới nhất\s*$|Đã hoàn tất phản hồi\s*$)/im)[0].trim();
  }
  const user = node => node.matches?.("[data-turn='user'],[data-message-author-role='user']") ||
    node.querySelector("[data-message-author-role='user']") || /^(you said|bạn đã nói)\s*:/i.test(textOf(node));
  function turns() {
    const roles = [...document.querySelectorAll("[data-message-author-role='assistant']")];
    if (roles.length) return roles;
    // Prefer whole turns: a reply may contain tool steps, text and rendered data cards.
    const articles = [...document.querySelectorAll("main article, main [data-testid^='conversation-turn'], main [data-turn='assistant']")];
    const outer = articles.filter(node => !articles.some(other => other !== node && other.contains(node)));
    // New UI may render reports as cards without role/prose attributes.
    // These are conversation articles; exclude user turns instead of requiring a text renderer.
    if (outer.length) {
      const replies = outer.filter(node => !user(node));
      if (replies.length) return replies;
    }
    // Reference engine fallback, including layouts without a semantic <main> wrapper.
    const blocks = [...document.querySelectorAll(".markdown, [class*='markdown'], .prose, [data-message-id] p")]
      .filter(node => !node.closest?.("[data-message-author-role='user'],[data-turn='user'],form,[contenteditable='true'],nav,aside"));
    const outerBlocks = blocks.filter(node => !blocks.some(other => other !== node && other.contains(node)));
    if (outerBlocks.length) return outerBlocks;
    // Verified from the user's diagnostic: the new UI has no article, role,
    // markdown or turn attributes, but main exposes localized speaker labels.
    return [...document.querySelectorAll("main")].filter(node => {
      if (!labeledReply(textOf(node))) return false;
      labeledSurfaces.add(node);
      return true;
    });
  }
  function text(turn) {
    if (labeledSurfaces.has(turn)) return labeledReply(textOf(turn));
    // Read the full response container to preserve rendered tables/cards as text too.
    return textOf(turn).replace(/^(chatgpt said|chatgpt đã nói)\s*:\s*/i, "").trim();
  }
  function busy() {
    return Boolean(globalThis.T12Composer.find([
      "button[data-testid='stop-button']", "button[data-testid='stop-generating-button']",
      "button[aria-label='Stop generating']", "button[aria-label='Dừng tạo']",
      "button[aria-label='Dừng tạo phản hồi']",
    ]));
  }
  function completed(turn) {
    if (busy()) return false;
    if (labeledSurfaces.has(turn)) {
      return Boolean(turn.querySelector("button[aria-label='Đánh giá câu trả lời'],button[aria-label='Tạo lại câu trả lời'],button[aria-label='Read aloud'],button[aria-label='Đọc to']")) &&
        /(?:Đã hoàn tất phản hồi|Response complete)/i.test(textOf(document.body));
    }
    if (["complete", "completed"].includes(turn.getAttribute("data-turn-status"))) return true;
    if (turn.querySelector("[data-testid*='copy-turn-action'],[data-testid*='good-response-turn-action'],[data-testid*='bad-response-turn-action']")) return true;
    // Only response-level actions; ignore copy buttons inside code blocks.
    return [...turn.querySelectorAll("button[aria-label],button[data-testid]")].some(button =>
      !button.closest("pre,code") && /^(copy response|copy message|copy|sao chép phản hồi|sao chép câu trả lời|sao chép tin nhắn|sao chép|good response|bad response|phản hồi tốt|phản hồi không tốt)[.!]?$/i.test(button.getAttribute("aria-label") || ""));
  }
  function snapshot() { return new Map(turns().map(turn => [turn, text(turn)])); }
  function latest(before) {
    return turns().filter(turn => text(turn) && (!before.has(turn) || before.get(turn) !== text(turn))).at(-1) || null;
  }
  function submitted(before, initialURL, editor) {
    return busy() || Boolean(latest(before)) ||
      (location.href !== initialURL && /\/c\//.test(location.pathname)) ||
      Boolean(editor && !textOf(editor) && !editor.value);
  }
  globalThis.T12Conversation = { snapshot, latest, text, busy, completed, submitted };
})();
