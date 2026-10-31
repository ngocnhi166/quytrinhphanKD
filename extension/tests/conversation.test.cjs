const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function turn(text, { user = false, done = false, role = true } = {}) {
  return {
    innerText: text,
    contains: () => false,
    matches: () => user,
    getAttribute: key => key === 'data-turn' && role ? (user ? 'user' : 'assistant') : null,
    querySelector: selector => {
      if (selector === "[data-message-author-role='user']") return null;
      if (selector.includes('.markdown')) return {};
      if (selector.includes("copy-turn-action") && done) return {};
      return null;
    },
    querySelectorAll: () => [],
  };
}
function setup() {
  const state = { turns: [], busy: false, blocks: [], main: [] };
  const location = { href: 'https://chatgpt.com/', pathname: '/' };
  const document = { body: { innerText: '' }, querySelectorAll: selector => selector === 'main' ? state.main : selector.startsWith('main') ? state.turns : selector.startsWith('.markdown') ? state.blocks : [] };
  const context = vm.createContext({ document, location, T12Composer: { find: () => state.busy ? {} : null } });
  vm.runInContext(fs.readFileSync(require.resolve('../conversation.js'), 'utf8'), context);
  return { helper: context.T12Conversation, state, location, document };
}
test('recognizes successful send when SPA changes URL with no role attributes', () => {
  const { helper, location } = setup();
  const before = helper.snapshot();
  location.href = 'https://chatgpt.com/c/new'; location.pathname = '/c/new';
  assert.equal(helper.submitted(before, 'https://chatgpt.com/', null), true);
});
test('reads completed article response without data-message-author-role', () => {
  const { helper, state } = setup();
  const before = helper.snapshot();
  const reply = turn('PHÂN TÍCH DOANH SỐ\nTổng doanh thu\n5,6685 tỷ', { role: false, done: true });
  state.turns = [turn('User prompt', { user: true }), reply];
  assert.equal(helper.latest(before), reply);
  assert.match(helper.text(reply), /5,6685 tỷ/);
  assert.equal(helper.completed(reply), true);
});
test('does not return old replies or treat stable tool output as complete', () => {
  const { helper, state } = setup();
  state.turns = [turn('Previous answer', { done: true })];
  const before = helper.snapshot();
  assert.equal(helper.latest(before), null);
  const partial = turn('Đã phân tích');
  state.turns.push(partial);
  assert.equal(helper.latest(before), partial);
  assert.equal(helper.completed(partial), false);
  state.busy = true;
  assert.equal(helper.completed(turn('Still generating', { done: true })), false);
});
test('recognizes cleared composer and does not mistake nonempty prompt for send', () => {
  const { helper } = setup();
  assert.equal(helper.submitted(new Map(), 'https://chatgpt.com/', { innerText: 'Prompt' }), false);
  assert.equal(helper.submitted(new Map(), 'https://chatgpt.com/', { innerText: '', value: '' }), true);
});
test('recognizes a report article without role or markdown renderer', () => {
  const { helper, state } = setup();
  const report = turn('BÁO CÁO\nTổng doanh thu 5,6685 tỷ', { role: false, done: true });
  const original = report.querySelector;
  report.querySelector = selector => selector.includes('.markdown') ? null : original(selector);
  state.turns = [report];
  assert.equal(helper.latest(new Map()), report);
  assert.equal(helper.completed(report), true);
});
test('reads markdown fallback when page has no main or role attributes', () => {
  const { helper, state } = setup();
  const before = helper.snapshot();
  const reply = turn('Thủ đô Việt Nam là Hà Nội.');
  reply.closest = () => null;
  state.blocks = [reply];
  assert.equal(helper.latest(before), reply);
  assert.match(helper.text(reply), /Hà Nội/);
});
test('markdown fallback excludes user messages and composer content', () => {
  const { helper, state } = setup();
  const prompt = turn('Thủ đô Việt Nam là gì?');
  prompt.closest = () => ({});
  state.blocks = [prompt];
  assert.equal(helper.latest(new Map()), null);
});
test('extracts exact answer from the actual diagnostic UI with zero role/markdown/article nodes', () => {
  const { helper, state, document } = setup();
  const before = helper.snapshot();
  const surface = turn('Ưu đãi miễn phí\nChia sẻ\nBạn đã nói:\nThủ đô của Việt Nam là gì?\n\nTrả lời ngắn gọn bằng văn bản, không cần phân tích tệp dữ liệu.\nChatGPT đã nói:\n\nThủ đô của Việt Nam là Hà Nội.\n\nChatGPT có thể mắc lỗi. Hãy kiểm tra thông tin quan trọng.\nPhản hồi mới nhất\n\nSuy luận');
  surface.querySelector = selector => selector.includes('Đánh giá câu trả lời') ? {} : null;
  document.body.innerText = surface.innerText + '\nĐã hoàn tất phản hồi';
  state.main = [surface];
  assert.equal(helper.latest(before), surface);
  assert.equal(helper.text(surface), 'Thủ đô của Việt Nam là Hà Nội.');
  assert.equal(helper.completed(surface), true);
  const saved = helper.snapshot();
  assert.equal(helper.latest(saved), null);
  surface.innerText += '\nBạn đã nói:\nCâu hỏi tiếp theo';
  assert.equal(helper.latest(saved), null);
});
