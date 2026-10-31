const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function element(extra = {}) {
  return { isConnected: true, getClientRects: () => [1], getAttribute: () => null, ...extra };
}
function load(matches) {
  const document = { querySelectorAll: selector => matches[selector] || [], title: 'ChatGPT' };
  const context = vm.createContext({ document, location: { origin: 'https://chatgpt.com', pathname: '/' } });
  vm.runInContext(fs.readFileSync(require.resolve('../composer.js'), 'utf8'), context);
  return context.T12Composer;
}
test('finds ProseMirror editor without placeholder or tabindex', () => {
  const editor = element();
  assert.equal(load({ ".ProseMirror[contenteditable='true']": [editor] }).editor(), editor);
});
test('skips hidden old editor and selects the visible replacement', () => {
  const hidden = element({ getClientRects: () => [] });
  const visible = element();
  assert.equal(load({ "textarea#prompt-textarea": [hidden, visible] }).editor(), visible);
});
test('finds actual editable descendant inside prompt wrapper', () => {
  const editor = element();
  assert.equal(load({ "#prompt-textarea [contenteditable='true']": [editor] }).editor(), editor);
});
test('supports plaintext-only editors and open shadow roots', () => {
  const editor = element();
  const shadowRoot = { querySelectorAll: selector => selector === "[role='textbox'][contenteditable='plaintext-only']" ? [editor] : [] };
  const helper = load({ '*': [element({ shadowRoot })] });
  assert.equal(helper.editor(), editor);
});
test('does not treat an arbitrary prompt container as an editor', () => {
  assert.equal(load({ '#prompt-textarea': [element()] }).editor(), null);
});
test('accepts multiline prompt with browser-normalized paragraph spacing', () => {
  const helper = load({});
  assert.equal(helper.hasPrompt({ innerText: 'Yêu cầu: Tổng quan\n\n THỐNG KÊ:\u00a0 {"sum": "362"}' }, 'Yêu cầu: Tổng quan\nTHỐNG KÊ: {"sum": "362"}'), true);
  assert.equal(helper.hasPrompt({ innerText: 'Nội dung bị thiếu' }, 'Nội dung đầy đủ'), false);
});
test('checks textContent when innerText omits part of the prompt', () => {
  assert.equal(load({}).hasPrompt({ innerText: 'Phần cuối', textContent: 'Phần đầu và phần cuối' }, 'Phần đầu và phần cuối'), true);
});
test('finds Vietnamese send button', () => {
  const button = element();
  assert.equal(load({ "button[aria-label='Gửi lời nhắc']": [button] }).sendButton(), button);
});
test('skips disabled send controls and uses enabled replacement', () => {
  const button = element();
  assert.equal(load({ "button[data-testid='send-button']": [element({ disabled: true }), element({ getAttribute: key => key === 'aria-disabled' ? 'true' : null }), button] }).sendButton(), button);
});
test('never treats stop or voice submit controls as send', () => {
  assert.equal(load({ "form button[type='submit']": [element({ getAttribute: key => key === 'aria-label' ? 'Dừng tạo' : null })] }).sendButton(), null);
  assert.equal(load({ "form button[type='submit']": [element({ getAttribute: key => key === 'aria-label' ? 'Start voice mode' : null })] }).sendButton(), null);
});
test('selects spreadsheet file input instead of first image-only input', () => {
  const input = accept => element({ getAttribute: key => key === 'accept' ? accept : null });
  const image = input('image/*');
  const sheet = input('.csv,.xlsx');
  const helper = load({ "input[type='file']": [image, sheet] });
  assert.equal(helper.fileInput('sales.csv'), sheet);
  assert.equal(helper.fileInput('sales.xlsx'), sheet);
  assert.equal(load({ "input[type='file']": [image] }).fileInput('sales.csv'), null);
});
