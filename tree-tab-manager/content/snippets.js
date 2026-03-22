// Tree Tab Manager - Snippets Capture Content Script
'use strict';

(function() {
  // すでにUIが存在する場合は早期リターン
  if (document.getElementById('ttm-snippet-dialog-host')) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CAPTURE_SNIPPET') {
      captureAndShowDialog(message.selectionText);
    } else if (message.type === 'SCROLL_TO_POSITION') {
      const { scrollY, text } = message;
      let attempts = 0;
      const maxAttempts = 15; // 拡張: Geminiなど遅いSPA用に
      
      const tryScroll = () => {
        const foundRect = quickFindTextRect(text);
        
        if (foundRect) {
          // If text is found on the current DOM, scroll to it directly.
          window.scrollTo({
            top: window.scrollY + foundRect.top - 150, // Leave more padding for floating headers
            behavior: 'smooth'
          });
          
          // try to scroll parent divs if any are scrollable
          const sel = window.getSelection();
          if (sel.rangeCount > 0) {
            let node = sel.getRangeAt(0).commonAncestorContainer;
            if (node.nodeType === 3) node = node.parentNode;
            if (node && node.scrollIntoView) {
              node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }

          setTimeout(() => highlightRange(text), 300);
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          const targetY = scrollY !== undefined ? scrollY : document.documentElement.scrollHeight;
          const jumpY = Math.min(document.documentElement.scrollHeight, targetY + (attempts * 1000));
          
          window.scrollTo(0, jumpY);
          
          // Also try to scroll any scrollable elements in the page (common in SPAs like Genspark)
          document.querySelectorAll('div').forEach(el => {
            if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) {
              const style = window.getComputedStyle(el);
              if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                el.scrollTop = jumpY;
              }
            }
          });
          
          setTimeout(tryScroll, 600);
          return;
        }

        // 最終的なフォールバック（位置だけ合わす）
        if (scrollY !== undefined) {
          window.scrollTo({
            top: scrollY,
            behavior: 'smooth'
          });
          document.querySelectorAll('div').forEach(el => {
            if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) {
              const style = window.getComputedStyle(el);
              if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                el.scrollTop = scrollY;
              }
            }
          });
        }
        setTimeout(() => highlightRange(text), 300);
      };

      tryScroll();
    }
  });

  // A helper function to find the rect of the text if it currently exists on the page
  function quickFindTextRect(text) {
    if (!text) return null;
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (window.find(text, false, false, true, false, true, false)) {
      if (sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return rect;
        }
      }
    }
    
    // Fallback: search text nodes manually (useful for some SPAs or shadow DOMs sometimes)
    sel.removeAllRanges(); // reset
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    
    // Create a simplified text for matching if exact match fails
    const searchTerms = text.split(/\s+/).filter(w => w.length > 2);
    
    while (node = walker.nextNode()) {
      const val = node.nodeValue;
      if (val.includes(text) || (searchTerms.length > 0 && searchTerms.every(term => val.includes(term)))) {
        const range = document.createRange();
        // Try to find the start index of the first match logic
        let idx = val.indexOf(text);
        if (idx === -1) {
          idx = val.indexOf(searchTerms[0]);
        }
        
        if (idx !== -1) {
          try {
            range.setStart(node, idx);
            // Don't overflow the node length
            range.setEnd(node, Math.min(val.length, idx + text.length));
            const rect = range.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              sel.addRange(range);
              return rect;
            }
          } catch(e) {
            // Ignore Range errors
          }
        }
      }
    }
    return null;
  }

  function highlightRange(text) {
    if (!text) return;
    
    // 既存のハイライトをクリア
    document.querySelectorAll('.ttm-nav-highlight').forEach(el => el.remove());

    const selection = window.getSelection();
    let hasSelection = selection.rangeCount > 0 && 
      (selection.toString().includes(text.substring(0, Math.min(10, text.length))) || text.includes(selection.toString().substring(0, Math.min(10, selection.toString().length))));
    
    // If not already selected by quickFindTextRect, try finding it again
    if (!hasSelection) {
      if (!quickFindTextRect(text)) return;
    }

    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rects = range.getClientRects();
      const currentScrollY = window.scrollY;
      const scrollX = window.scrollX;

      // Ensure the element is scrolled into view (especially for inner scrollable containers)
      let commonNode = range.commonAncestorContainer;
      if (commonNode.nodeType === 3) commonNode = commonNode.parentNode;
      if (commonNode && commonNode.scrollIntoView) {
        commonNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      const highlights = [];
      for (const rect of rects) {
        const overlay = document.createElement('div');
        overlay.className = 'ttm-nav-highlight';
        overlay.style.position = 'absolute';
        overlay.style.top = (rect.top + currentScrollY - 2) + 'px';
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

  function captureAndShowDialog(providedText) {
    const selection = window.getSelection();
    const selectedText = providedText || selection.toString().trim();
    
    // 選択範囲がない場合は終了
    if (!selectedText) {
      alert(chrome.i18n.getMessage('msgNoSelection') || 'Please select some text first.');
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Find the best scrollY: prefer the closest scrollable container's scroll position
    let scrollContainer = range.commonAncestorContainer;
    if (scrollContainer.nodeType === 3) scrollContainer = scrollContainer.parentNode;
    
    let containerScrollTop = 0;
    let el = scrollContainer;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        containerScrollTop = el.scrollTop;
        break;
      }
      el = el.parentElement;
    }

    // Use the larger of window.scrollY and the container's scrollTop as effective scroll position
    const effectiveScrollY = Math.max(window.scrollY, containerScrollTop) + rect.top - 100;

    showDialog(selectedText, Math.max(0, effectiveScrollY));
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

    const header = document.createElement('div');
    header.className = 'header';
    header.textContent = chrome.i18n.getMessage('ctxAddSnippet');
    dialog.appendChild(header);

    const titleField = document.createElement('div');
    titleField.className = 'field';
    const titleLabel = document.createElement('div');
    titleLabel.className = 'label';
    titleLabel.textContent = chrome.i18n.getMessage('ctxEditName');
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.id = 'name';
    titleInput.placeholder = chrome.i18n.getMessage('snippetNamePlaceholder');
    titleInput.value = text.substring(0, 30) + (text.length > 30 ? '...' : '');
    titleField.appendChild(titleLabel);
    titleField.appendChild(titleInput);
    dialog.appendChild(titleField);

    const textField = document.createElement('div');
    textField.className = 'field';
    const textLabel = document.createElement('div');
    textLabel.className = 'label';
    textLabel.textContent = chrome.i18n.getMessage('snippetTextPlaceholder');
    const textArea = document.createElement('textarea');
    textArea.id = 'text';
    textArea.value = text;
    textField.appendChild(textLabel);
    textField.appendChild(textArea);
    dialog.appendChild(textField);

    const descField = document.createElement('div');
    descField.className = 'field';
    const descLabel = document.createElement('div');
    descLabel.className = 'label';
    descLabel.textContent = chrome.i18n.getMessage('snippetDescPlaceholder');
    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.id = 'desc';
    descInput.placeholder = chrome.i18n.getMessage('snippetDescPlaceholder');
    descInput.value = document.title;
    descField.appendChild(descLabel);
    descField.appendChild(descInput);
    dialog.appendChild(descField);

    const footer = document.createElement('div');
    footer.className = 'footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.id = 'cancel';
    cancelBtn.textContent = chrome.i18n.getMessage('btnCancelSnippet') || 'Cancel';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.id = 'save';
    saveBtn.textContent = chrome.i18n.getMessage('btnSaveSnippet') || 'Save';
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    dialog.appendChild(footer);

    shadow.appendChild(style);
    shadow.appendChild(dialog);
    document.body.appendChild(host);

    titleInput.focus();
    titleInput.select();

    const close = () => {
      document.body.removeChild(host);
    };

    shadow.getElementById('cancel').onclick = close;
    shadow.getElementById('save').onclick = () => {
      const name = titleInput.value.trim() || textArea.value.substring(0, 50);
      const description = descInput.value.trim();
      const currentText = textArea.value;
      
      chrome.runtime.sendMessage({
        type: 'SAVE_SNIPPET',
        snippet: {
          id: 'snip_' + Date.now(),
          name: name,
          text: currentText,
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
