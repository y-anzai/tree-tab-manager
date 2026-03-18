// Tree Tab Manager - Snippets Capture Content Script
'use strict';

(function() {
  // すでにUIが存在する場合は早期リターン
  if (document.getElementById('ttm-snippet-dialog-host')) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CAPTURE_SNIPPET') {
      captureAndShowDialog();
    } else if (message.type === 'SCROLL_TO_POSITION') {
      const { scrollY, text } = message;
      let attempts = 0;
      const maxAttempts = 10;
      
      const tryScroll = () => {
        const currentMaxScroll = document.documentElement.scrollHeight - window.innerHeight;
        
        if (currentMaxScroll < scrollY && attempts < maxAttempts) {
          attempts++;
          window.scrollTo(0, document.documentElement.scrollHeight);
          setTimeout(tryScroll, 500);
          return;
        }

        window.scrollTo({
          top: scrollY,
          behavior: 'smooth'
        });

        // 位置の調整とハイライトをより高速に実行
        const highlightAction = () => {
          window.scrollTo({ top: scrollY, behavior: 'instant' });
          highlightRange(text);
        };

        // スクロール量が少ない場合は即座に、多い場合も待ち時間を短縮
        const scrollDiff = Math.abs(window.scrollY - scrollY);
        setTimeout(highlightAction, scrollDiff < 100 ? 50 : 300);
      };

      tryScroll();
    }
  });

  function highlightRange(text) {
    if (!text) return;
    
    // 既存のハイライトをクリア
    document.querySelectorAll('.ttm-nav-highlight').forEach(el => el.remove());

    // 前方検索を試みる
    const found = window.find(text, false, false, true, false, true, false);
    if (!found) return;

    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rects = range.getClientRects();
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;

      const highlights = [];
      for (const rect of rects) {
        const overlay = document.createElement('div');
        overlay.className = 'ttm-nav-highlight';
        overlay.style.position = 'absolute';
        overlay.style.top = (rect.top + scrollY - 2) + 'px';
        overlay.style.left = (rect.left + scrollX - 2) + 'px';
        overlay.style.width = (rect.width + 4) + 'px';
        overlay.style.height = (rect.height + 4) + 'px';
        overlay.style.backgroundColor = 'rgba(255, 235, 59, 0.4)'; // 黄色
        overlay.style.border = '2px solid #fbc02d';
        overlay.style.borderRadius = '4px';
        overlay.style.zIndex = '2147483646';
        overlay.style.pointerEvents = 'none';
        overlay.style.boxShadow = '0 0 15px rgba(255, 235, 59, 0.6)';
        overlay.style.transition = 'opacity 0.4s ease-out, transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        overlay.style.transform = 'scale(1.3)';
        document.body.appendChild(overlay);
        highlights.push(overlay);
        
        // アニメーション用 (即時)
        requestAnimationFrame(() => {
          overlay.style.transform = 'scale(1)';
        });
      }

      // しばらくしたら選択解除
      setTimeout(() => selection.removeAllRanges(), 1000);

      // 3秒後にフェードアウトして削除
      setTimeout(() => {
        highlights.forEach(h => {
          h.style.opacity = '0';
          setTimeout(() => h.remove(), 1000);
        });
      }, 3000);
    }
  }

  function captureAndShowDialog() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    // 選択範囲がない場合は終了
    if (!selectedText) {
      alert(chrome.i18n.getMessage('emptyTabs')); // または適切なメッセージ
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const scrollY = window.scrollY + rect.top - 100; // 少し上に余白を持たせる

    showDialog(selectedText, Math.max(0, scrollY));
  }

  function showDialog(text, scrollY) {
    const host = document.createElement('div');
    host.id = 'ttm-snippet-dialog-host';
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(2px);
      }
      .dialog {
        background: #1e1e2e;
        color: #cdd6f4;
        width: 400px;
        padding: 24px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        border: 1px solid #45475a;
        display: flex;
        flex-direction: column;
        gap: 16px;
        animation: fadeIn 0.2s ease-out;
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .header {
        font-size: 18px;
        font-weight: 600;
        margin-bottom: 4px;
        color: #89b4fa;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .label {
        font-size: 12px;
        color: #a6adc8;
        font-weight: 500;
      }
      input, textarea {
        background: #313244;
        border: 1px solid #45475a;
        color: #cdd6f4;
        padding: 10px 12px;
        border-radius: 6px;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
      }
      input:focus, textarea:focus {
        border-color: #89b4fa;
      }
      textarea {
        height: 80px;
        resize: none;
        word-break: break-all;
      }
      .footer {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 8px;
      }
      button {
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.2s, background 0.2s;
        border: none;
      }
      .btn-primary {
        background: #89b4fa;
        color: #1e1e2e;
      }
      .btn-primary:hover {
        background: #b4befe;
      }
      .btn-secondary {
        background: transparent;
        color: #a6adc8;
      }
      .btn-secondary:hover {
        background: #313244;
      }
    `;

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <div class="header">${chrome.i18n.getMessage('ctxAddSnippet')}</div>
      
      <div class="field">
        <div class="label">${chrome.i18n.getMessage('ctxEditName')}</div>
        <input type="text" id="name" placeholder="${chrome.i18n.getMessage('snippetNamePlaceholder')}" value="${text.substring(0, 30)}${text.length > 30 ? '...' : ''}">
      </div>

      <div class="field">
        <div class="label">${chrome.i18n.getMessage('snippetTextPlaceholder')}</div>
        <textarea readonly>${text}</textarea>
      </div>

      <div class="field">
        <div class="label">${chrome.i18n.getMessage('snippetDescPlaceholder')}</div>
        <input type="text" id="desc" placeholder="${chrome.i18n.getMessage('snippetDescPlaceholder')}">
      </div>

      <div class="footer">
        <button class="btn-secondary" id="cancel">${chrome.i18n.getMessage('btnCancelSnippet')}</button>
        <button class="btn-primary" id="save">${chrome.i18n.getMessage('btnSaveSnippet')}</button>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(dialog);
    document.body.appendChild(host);

    const nameInput = shadow.getElementById('name');
    const descInput = shadow.getElementById('desc');
    nameInput.focus();
    nameInput.select();

    const close = () => {
      document.body.removeChild(host);
    };

    shadow.getElementById('cancel').onclick = close;
    shadow.getElementById('save').onclick = () => {
      const name = nameInput.value.trim() || text.substring(0, 50);
      const description = descInput.value.trim();
      
      chrome.runtime.sendMessage({
        type: 'SAVE_SNIPPET',
        snippet: {
          id: 'snip_' + Date.now(),
          name: name,
          text: text,
          description: description,
          url: window.location.href,
          title: document.title,
          favIconUrl: getFavicon(),
          scrollY: scrollY,
          timestamp: Date.now()
        }
      }, (response) => {
        close();
      });
    };

    // Close on Esc
    host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        shadow.getElementById('save').click();
      }
    });
  }

  function getFavicon() {
    let icon = '';
    const links = document.getElementsByTagName('link');
    for (let i = 0; i < links.length; i++) {
      const rel = links[i].getAttribute('rel');
      if (rel && rel.includes('icon')) {
        icon = links[i].getAttribute('href');
        break;
      }
    }
    if (!icon) return '';
    if (icon.startsWith('//')) icon = window.location.protocol + icon;
    else if (icon.startsWith('/')) icon = window.location.origin + icon;
    else if (!icon.startsWith('http')) icon = window.location.origin + '/' + icon;
    return icon;
  }
})();
