(() => {
  const properties = ('display position top right bottom left width height min-width max-width min-height max-height padding margin gap row-gap column-gap grid-template-columns grid-template-rows flex-direction flex-wrap flex-grow flex-shrink flex-basis justify-content align-items align-content border border-radius border-collapse border-spacing background-color color font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration white-space vertical-align overflow overflow-x overflow-y opacity box-shadow transform transform-origin fill stroke stroke-width').split(' ');
  globalThis.T12Report = {
    lastError: null,
    capture(source) {
      this.lastError = null;
      try {
        const styleRules = new Map();
        const clone = source.cloneNode(true);
        const originals = [source, ...source.querySelectorAll('*')];
        const copies = [clone, ...clone.querySelectorAll('*')];
        originals.forEach((original, i) => {
          const target = copies[i];
          const style = getComputedStyle(original);
          target.removeAttribute('style');
          const declarations = [];
          for (const property of properties) {
            const value = style.getPropertyValue(property);
            if (value && !/url\s*\(/i.test(value)) declarations.push(`${property}:${value}`);
          }
          const css = declarations.join(';');
          if (!styleRules.has(css)) styleRules.set(css, `t12-style-${styleRules.size}`);
          target.setAttribute('class', styleRules.get(css));
          if (original.tagName === 'CANVAS') {
            try {
              const image = document.createElement('img');
              image.src = original.toDataURL('image/png');
              image.className = target.getAttribute('class');
              target.replaceWith(image);
            } catch { /* Keep other report content when canvas cannot be exported. */ }
          }
        });
        let content = clone;
        // The observed ChatGPT UI exposes speaker labels rather than message IDs.
        if (source.tagName === 'MAIN') {
          const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
          let node, start, end;
          while ((node = walker.nextNode())) {
            const value = node.textContent.trim();
            // Labels may split the colon into another span/text node.
            if (/^(ChatGPT đã nói|ChatGPT said)\s*:?$/.test(value)) { start = node; end = null; }
            else if (start && !end && /^(ChatGPT có thể mắc lỗi\.|ChatGPT can make mistakes\.|Phản hồi mới nhất|Đã hoàn tất phản hồi)/.test(value)) end = node;
          }
          if (!start) throw new Error('Không tìm thấy ranh giới phần trả lời để giữ định dạng.');
          const range = document.createRange();
          range.selectNodeContents(clone);
          range.setStartAfter(start);
          if (end) range.setEndBefore(end);
          content = document.createElement('div');
          content.append(range.cloneContents());
        }
        content.querySelectorAll('script,style,link,meta,base,iframe,object,embed,form,input,textarea,button,nav,aside,[contenteditable],audio,video,foreignObject,animate,animateTransform,set').forEach(el => el.remove());
        for (const element of [content, ...content.querySelectorAll('*')]) {
          for (const attr of [...element.attributes]) {
            if (/^on/i.test(attr.name) || /^(srcdoc|srcset|action|formaction)$/i.test(attr.name)) element.removeAttribute(attr.name);
            if (/^(href|xlink:href)$/i.test(attr.name) && !attr.value.startsWith('#')) element.removeAttribute(attr.name);
            if (attr.name === 'src' && !/^data:image\/(png|jpeg|webp);base64,/i.test(attr.value)) element.removeAttribute('src');
          }
        }
        // Keep only styles actually referenced by the extracted answer.
        const used = new Set([...content.querySelectorAll('[class]')].map(el => el.getAttribute('class')));
        const stylesheet = [...styleRules].filter(([, name]) => used.has(name)).map(([css, name]) => `.${name}{${css}}`).join('\n');
        const html = `<style>${stylesheet.replace(/</g, '\\3c ')}</style>` + content.innerHTML;
        if (html.length > 2000000) throw new Error('Bản định dạng vượt giới hạn 2 MB.');
        return html;
      } catch (error) {
        this.lastError = error.message;
        console.warn('[T12] Report snapshot failed', error);
        return null;
      }
    },
  };
})();
