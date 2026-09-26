/**
 * SLUGA Telegram Messenger — Main Application Controller v2.0
 * ONE-SHOT PAIRING: pair_screen (1 раз) → unlock (PIN) → chat
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- Состояние приложения ---
  const state = {
    currentSessionId: 'sluga_core',
    pendingAttachments: [],
    isRecordingVoice: false,
    settings: window.SlugaStorage ? window.SlugaStorage.getSettings() : {
      serverUrl: '', botToken: '', model: 'claude-sonnet-4-6',
      voiceAutoplay: true, pinCode: '', isPaired: false
    }
  };

  // --- Элементы интерфейса ---
  const appContainer      = document.getElementById('appContainer');
  const messagesContainer = document.getElementById('messagesContainer');
  const typingIndicator   = document.getElementById('typingIndicator');
  const messageInput      = document.getElementById('messageInput');
  const btnAction         = document.getElementById('btnAction');
  const btnAttach         = document.getElementById('btnAttach');
  const fileInput         = document.getElementById('fileInput');
  const attachmentPreviewBar = document.getElementById('attachmentPreviewBar');
  const headerTitle       = document.getElementById('headerTitle');
  const headerAvatar      = document.getElementById('headerAvatar');
  const headerStatus      = document.getElementById('headerStatus');
  const connDot           = document.getElementById('connDot');
  const btnTopMenu        = document.getElementById('btnTopMenu');
  const btnTgMenu         = document.getElementById('btnTgMenu');
  const telegramCommandPopup = document.getElementById('telegramCommandPopup');
  const btnCloseCmdMenu   = document.getElementById('btnCloseCmdMenu');
  const settingsModal     = document.getElementById('settingsModal');
  const btnCloseSettings  = document.getElementById('btnCloseSettings');
  const btnCancelSettings = document.getElementById('btnCancelSettings');
  const btnSaveSettings   = document.getElementById('btnSaveSettings');
  const pinLockModal      = document.getElementById('pinLockModal');
  const inputUnlockPin    = document.getElementById('inputUnlockPin');
  const btnUnlockApp      = document.getElementById('btnUnlockApp');
  const pinErrorMsg       = document.getElementById('pinErrorMsg');
  const pinLockServerUrl  = document.getElementById('pinLockServerUrl');
  const btnChangeServer   = document.getElementById('btnChangeServer');

  // --- PAIR SCREEN элементы ---
  const pairOverlay     = document.getElementById('pairScreenOverlay');
  const pairServerUrl   = document.getElementById('pairServerUrl');
  const pairBtnCheck    = document.getElementById('pairBtnCheck');
  const pairServerStatus = document.getElementById('pairServerStatus');
  const pairBotToken    = document.getElementById('pairBotToken');
  const pairBtnToggleToken = document.getElementById('pairBtnToggleToken');
  const pairEnablePin   = document.getElementById('pairEnablePin');
  const pairPinWrap     = document.getElementById('pairPinWrap');
  const pairPinInput    = document.getElementById('pairPinInput');
  const pairBtnConnect  = document.getElementById('pairBtnConnect');
  const pairError       = document.getElementById('pairError');

  // Helper для нормализации HTTP URL (работает для http://, https://, ws://, wss:// и голых доменов)
  function toHttpUrl(raw) {
    let url = (raw || (typeof window !== 'undefined' && window.location ? window.location.origin : '') || '').trim();
    if (!url) return (typeof window !== 'undefined' && window.location ? window.location.origin : '');
    if (!/^https?:\/\//i.test(url)) {
      if (/^wss:\/\//i.test(url)) {
        url = 'https://' + url.slice(6);
      } else if (/^ws:\/\//i.test(url)) {
        url = 'http://' + url.slice(5);
      } else {
        const isHttps = (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:');
        url = (isHttps ? 'https://' : 'http://') + url;
      }
    }
    return url.replace(/\/ws\/?$/i, '').replace(/\/+$/, '');
  }

  // Загрузка истории чата из SQLite по HTTP REST API
  async function loadHistoryOverHttp() {
    try {
      const httpBase = toHttpUrl(state.settings.serverUrl);
      const token = state.settings.botToken;
      if (!httpBase || !token) return;
      const res = await fetch(`${httpBase}/api/history/${state.currentSessionId}?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const history = await res.json();
        if (Array.isArray(history) && history.length > 0) {
          renderChatHistory(history);
        }
      }
    } catch (e) {
      console.warn('[History] HTTP load info:', e);
    }
  }

  // --- Инстансы ---
  const wsClient = new SlugaWebSocketClient();
  const voiceManager = new SlugaVoiceManager();

  // =========================================================
  // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ СТАТУС-БАРА
  // =========================================================
  function setStatus(text, mode = 'idle') {
    // mode: 'online' | 'offline' | 'pairing' | 'idle'
    if (headerStatus) headerStatus.textContent = text;
    if (connDot) {
      connDot.className = 'conn-dot';
      if (mode !== 'idle') connDot.classList.add(mode);
    }
    if (headerStatus) {
      const colors = { online: '#4fae4e', offline: '#e53935', pairing: '#ff9800', idle: '#7f91a4' };
      headerStatus.style.color = colors[mode] || '#7f91a4';
    }
  }

  // =========================================================
  // ЛОГИКА ЗАПУСКА: pair → unlock → chat
  // =========================================================

  function showPairScreen() {
    if (pairOverlay) {
      pairOverlay.classList.add('active');
      // Скрываем PIN-окно, если оно видимо
      if (pinLockModal) pinLockModal.classList.remove('active');
      setTimeout(() => pairServerUrl && pairServerUrl.focus(), 100);
    }
  }

  function hidePairScreen() {
    if (pairOverlay) pairOverlay.classList.remove('active');
  }

  function showUnlockScreen() {
    if (pinLockModal) {
      // Показываем адрес сервера в экране разблокировки
      const rawUrl = state.settings.serverUrl || '';
      const displayUrl = rawUrl.replace(/^wss?:\/\//, '').replace(/\/ws$/, '');
      if (pinLockServerUrl) pinLockServerUrl.textContent = displayUrl ? `📡 ${displayUrl}` : '';
      pinLockModal.classList.add('active');
      if (inputUnlockPin) { inputUnlockPin.value = ''; inputUnlockPin.focus(); }
    }
  }

  function startApp() {
    hidePairScreen();
    if (pinLockModal) pinLockModal.classList.remove('active');
    initWebSocket();
  }

  // Определяем путь входа
  const hasPaired = state.settings.isPaired &&
                    state.settings.serverUrl &&
                    state.settings.botToken;

  if (!hasPaired) {
    // ПЕРВЫЙ ЗАПУСК — показываем pair_screen
    showPairScreen();
  } else if (state.settings.pinCode) {
    // ПОВТОРНЫЙ ЗАПУСК с PIN — показываем unlock
    showUnlockScreen();
  } else {
    // ПОВТОРНЫЙ ЗАПУСК без PIN — мгновенный вход
    startApp();
  }

  // =========================================================
  // PAIR SCREEN: логика
  // =========================================================

  // Активируем кнопку подключения при наличии данных в обоих полях
  function validatePairForm() {
    if (pairServerUrl && !pairServerUrl.value) {
      const locOrigin = (window.location && window.location.origin && window.location.origin.startsWith('http'))
        ? window.location.origin : '';
      pairServerUrl.value = locOrigin;
    }
    if (pairBotToken && !pairBotToken.value) {
      pairBotToken.value = state.settings.botToken || '';
    }
    const hasUrl   = (pairServerUrl?.value || '').trim().length > 3;
    const hasToken = (pairBotToken?.value || '').trim().length > 3;
    if (pairBtnConnect) pairBtnConnect.disabled = !(hasUrl && hasToken);
  }
  if (pairServerUrl) pairServerUrl.addEventListener('input', validatePairForm);
  if (pairBotToken)  pairBotToken.addEventListener('input', validatePairForm);
  setTimeout(validatePairForm, 100);

  // Переключение видимости токена (глазок)
  if (pairBtnToggleToken && pairBotToken) {
    pairBtnToggleToken.addEventListener('click', () => {
      const isPass = pairBotToken.type === 'password';
      pairBotToken.type = isPass ? 'text' : 'password';
      pairBtnToggleToken.textContent = isPass ? '🙈' : '👁️';
      pairBtnToggleToken.title = isPass ? 'Скрыть токен' : 'Показать токен';
      pairBotToken.focus();
    });
  }

  // PIN toggle
  if (pairEnablePin) {
    pairEnablePin.addEventListener('change', () => {
      if (pairPinWrap) pairPinWrap.classList.toggle('visible', pairEnablePin.checked);
      if (pairEnablePin.checked && pairPinInput) pairPinInput.focus();
    });
  }

  // Кнопка «Проверить» — делаем GET /api/info без токена
  if (pairBtnCheck) {
    pairBtnCheck.addEventListener('click', async () => {
      const rawUrl = (pairServerUrl?.value || window.location.origin || '').trim();
      if (!rawUrl) return;
      const httpBase = toHttpUrl(rawUrl);
      const httpUrl = `${httpBase}/api/info`;
      pairBtnCheck.disabled = true;
      if (pairServerStatus) { pairServerStatus.textContent = '⏳ проверка...'; pairServerStatus.style.color = '#ff9800'; }
      try {
        const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(5000) });
        const json = await resp.json();
        if (json.ok) {
          if (pairServerStatus) {
            pairServerStatus.textContent = `✅ ${json.name || 'SLUGA'} онлайн • ${json.model || ''}`;
            pairServerStatus.style.color = '#4fae4e';
          }
        } else { throw new Error('bad response'); }
      } catch (e) {
        if (pairServerStatus) { pairServerStatus.textContent = '❌ Сервер недоступен. Проверьте адрес и порт.'; pairServerStatus.style.color = '#e53935'; }
      } finally {
        pairBtnCheck.disabled = false;
      }
    });
  }

  // Кнопка «Подключить и сохранить»
  if (pairBtnConnect) {
    pairBtnConnect.addEventListener('click', async () => {
      const rawUrl  = (pairServerUrl?.value || window.location.origin || '').trim();
      const token   = (pairBotToken?.value || '').trim();
      const pinVal  = pairEnablePin?.checked ? (pairPinInput?.value || '').trim() : '';

      if (!rawUrl || !token) {
        if (pairError) { pairError.textContent = 'Заполните адрес сервера и Bot Token.'; pairError.style.display = 'block'; }
        return;
      }

      if (pairError) pairError.style.display = 'none';
      pairBtnConnect.disabled = true;
      pairBtnConnect.textContent = '⏳ авторизация...';

      // 1. Быстрая проверка авторизации по HTTP API
      try {
        const httpBase = rawUrl.replace(/^wss?:\/\//, 'https://').replace(/^http:\/\//, 'http://').replace(/\/ws$/, '');
        const authUrl = `${httpBase}/api/auth_check?token=${encodeURIComponent(token)}`;
        const resp = await fetch(authUrl, { signal: AbortSignal.timeout(4000) });
        if (resp.ok) {
          const authData = await resp.json();
          const newSettings = {
            ...state.settings,
            serverUrl: rawUrl,
            botToken:  token,
            pinCode:   pinVal,
            model:     authData.model || 'gpt-5.6-sol',
            isPaired:  true
          };
          state.settings = newSettings;
          if (window.SlugaStorage) window.SlugaStorage.saveSettings(newSettings);

          hidePairScreen();
          startApp();
          return;
        } else if (resp.status === 403) {
          if (pairError) { pairError.textContent = '❌ Неверный Bot Token (код 403 Forbidden).'; pairError.style.display = 'block'; }
          pairBtnConnect.disabled = false;
          pairBtnConnect.textContent = '🔗 Подключить и сохранить';
          return;
        }
      } catch (e) {
        console.warn('[Pair] HTTP check failed, fallback to WS...', e);
      }

      // 2. Резервная проверка через WebSocket
      const wsUrl = SlugaWebSocketClient.normalizeUrl(rawUrl);
      const testWs = new SlugaWebSocketClient();
      let done = false;

      const failTimeout = setTimeout(() => {
        if (done) return;
        done = true;
        testWs.destroy();
        if (pairError) { pairError.textContent = 'Сервер не ответил. Проверьте адрес и Bot Token.'; pairError.style.display = 'block'; }
        if (pairBtnConnect) { pairBtnConnect.disabled = false; pairBtnConnect.textContent = '🔗 Подключить и сохранить'; }
      }, 5000);

      testWs.on('authenticated', () => {
        if (done) return;
        done = true;
        clearTimeout(failTimeout);
        testWs.destroy();
        const newSettings = {
          ...state.settings,
          serverUrl: wsUrl,
          botToken:  token,
          pinCode:   pinVal,
          isPaired:  true
        };
        state.settings = newSettings;
        if (window.SlugaStorage) window.SlugaStorage.saveSettings(newSettings);
        hidePairScreen();
        startApp();
      });

      testWs.on('error', () => {
        if (done) return;
        done = true;
        clearTimeout(failTimeout);
        testWs.destroy();
        if (pairError) { pairError.textContent = 'Неверный Bot Token или ошибка подключения.'; pairError.style.display = 'block'; }
        if (pairBtnConnect) { pairBtnConnect.disabled = false; pairBtnConnect.textContent = '🔗 Подключить и сохранить'; }
      });

      testWs.connect(wsUrl, token);
    });
  }

  // =========================================================
  // UNLOCK SCREEN: PIN + кнопка «Сменить сервер»
  // =========================================================

  const checkPin = () => {
    const entered = (inputUnlockPin?.value || '').trim();
    if (entered === state.settings.pinCode) {
      if (pinLockModal) pinLockModal.classList.remove('active');
      if (pinErrorMsg) pinErrorMsg.style.display = 'none';
      if (inputUnlockPin) inputUnlockPin.value = '';
      initWebSocket();
    } else {
      if (pinErrorMsg) pinErrorMsg.style.display = 'block';
      if (inputUnlockPin) { inputUnlockPin.value = ''; inputUnlockPin.focus(); }
    }
  };

  if (btnUnlockApp) btnUnlockApp.addEventListener('click', checkPin);

  // Авто-сабмит при вводе последней цифры PIN
  if (inputUnlockPin) {
    inputUnlockPin.addEventListener('input', () => {
      const len = state.settings.pinCode ? state.settings.pinCode.length : 4;
      if (inputUnlockPin.value.length >= len) checkPin();
    });
    inputUnlockPin.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkPin(); });
  }

  // Кнопка «Сменить сервер» — сброс паринга, выход на pair_screen
  if (btnChangeServer) {
    btnChangeServer.addEventListener('click', () => {
      // Сбрасываем isPaired, чтобы снова попасть на pair_screen
      state.settings.isPaired = false;
      if (window.SlugaStorage) window.SlugaStorage.saveSettings(state.settings);
      wsClient.destroy();
      showPairScreen();
      // Предзаполняем поля текущими значениями для удобства
      if (pairServerUrl) {
        const cur = state.settings.serverUrl || '';
        pairServerUrl.value = cur.replace(/^wss?:\/\//, '').replace(/\/ws$/, '');
      }
      if (pairBotToken) pairBotToken.value = state.settings.botToken || '';
      validatePairForm();
    });
  }

  // =========================================================
  // WebSocket инициализация
  // =========================================================
  const initWebSocket = async () => {
    const sUrl  = (state.settings.serverUrl || window.location.origin || '').trim();
    const token = (state.settings.botToken  || '').trim();
    if (!sUrl || !token) {
      setStatus('Нет настроек — войдите через паринг', 'pairing');
      showPairScreen();
      return;
    }
    setStatus('подключение...', 'pairing');

    // Проверяем статус сервера через HTTP API
    try {
      const httpBase = sUrl.replace(/^wss?:\/\//, 'https://').replace(/^http:\/\//, 'http://').replace(/\/ws$/, '');
      const resp = await fetch(`${httpBase}/api/auth_check?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(4000) });
      if (resp.ok) {
        const data = await resp.json();
        const model = data.model || state.settings.model || 'gpt-5.6-sol';
        setStatus(`• ${model} (24/7)`, 'online');
      }
    } catch (_) {}

    wsClient.connect(sUrl, token);
  };

  wsClient.on('connect', () => {
    setStatus(`• ${state.settings.model || 'gpt-5.6-sol'} (24/7)`, 'online');
  });

  wsClient.on('disconnect', () => {
    // В режиме гибридной связи запросы надежно идут через HTTP API 24/7
    setStatus(`• ${state.settings.model || 'gpt-5.6-sol'} (24/7)`, 'online');
  });

  wsClient.on('reconnecting', ({ attempt, maxAttempts, delayMs }) => {
    setStatus(`реконнект ${attempt}/${maxAttempts} (через ${Math.round(delayMs/1000)}с)`, 'offline');
  });

  wsClient.on('authenticated', (payload) => {
    const model = payload.model || payload.liteai_model || '';
    setStatus(model ? `• ${model}` : 'онлайн', 'online');
    const testResultEl = document.getElementById('connectionTestResult');
    if (testResultEl) {
      testResultEl.textContent = `✅ Сервер онлайн! Токен принят. Модель: ${model}`;
      testResultEl.style.color = '#4fae4e';
    }
  });

  wsClient.on('pong', ({ latencyMs }) => {
    if (latencyMs !== null && latencyMs !== undefined) {
      const info = wsClient.getConnectionInfo();
      const model = info.model ? ` • ${info.model}` : '';
      setStatus(`онлайн${model} • ${latencyMs}мс`, 'online');
    }
  });


  wsClient.on('status', (payload) => {
    if (payload.status === 'thinking') {
      typingIndicator.style.display = 'flex';
      scrollToBottom();
    } else if (payload.status === 'idle') {
      typingIndicator.style.display = 'none';
    }
  });

  wsClient.on('message', (payload) => {
    // 1. Прогресс размышления агента
    if (payload.event === 'progress') {
      typingIndicator.style.display = 'flex';
      const label = typingIndicator.querySelector('span');
      if (label) label.textContent = payload.text || 'SLUGA думает...';
      scrollToBottom();
      return;
    }

    typingIndicator.style.display = 'none';

    // 2. Загрузка истории чата из SQLite
    if (payload.event === 'history_loaded') {
      if (payload.session_id === state.currentSessionId && Array.isArray(payload.history)) {
        renderChatHistory(payload.history);
      }
      return;
    }

    // 3. Распознанный голос
    if (payload.event === 'voice_recognized') {
      console.log('[Voice] STT Recognized:', payload.text);
      return;
    }

    // 4. Ошибка
    if (payload.event === 'error') {
      renderIncomingMessage({
        text: `⚠️ **Ошибка сервера:** ${payload.error || 'Неизвестная ошибка'}`
      });
      return;
    }

    // 5. Ответ от ИИ-агента
    if (payload.event === 'message_response') {
      const msg = payload.message || {};
      renderIncomingMessage({
        text: msg.content || msg.text || '',
        audio_base64: msg.audio_base64 || payload.audio_base64
      });

      if ((msg.audio_base64 || payload.audio_base64) && state.settings.voiceAutoplay) {
        voiceManager.playBase64Audio(msg.audio_base64 || payload.audio_base64, 'audio/wav').catch(e => {
          console.warn('[Audio] Autoplay error:', e);
        });
      }
      return;
    }

    // Резервный формат ответа
    if (payload.text || payload.content) {
      renderIncomingMessage({
        text: payload.content || payload.text,
        audio_base64: payload.audio_base64
      });
    }
  });

  function renderChatHistory(historyList) {
    // Сохраняем только date-badge и индикатор
    const badges = messagesContainer.querySelectorAll('.date-badge');
    messagesContainer.innerHTML = '';
    const badge = document.createElement('div');
    badge.className = 'date-badge';
    badge.textContent = 'История сообщений';
    messagesContainer.appendChild(badge);

    historyList.forEach(item => {
      if (item.role === 'user') {
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble message-out';
        bubble.innerHTML = `
          <div class="message-text">${formatMarkdown(item.content)}</div>
          <div class="message-meta">
            <span>${item.created_at ? formatTime(new Date(item.created_at * 1000)) : ''}</span>
            <span class="checkmarks">✓✓</span>
          </div>
        `;
        messagesContainer.appendChild(bubble);
      } else {
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble message-in';
        bubble.innerHTML = `
          <div class="message-text">${formatMarkdown(item.content)}</div>
          <div class="message-meta">
            <span>${item.created_at ? formatTime(new Date(item.created_at * 1000)) : ''}</span>
            <span class="checkmarks">✓✓</span>
          </div>
        `;
        messagesContainer.appendChild(bubble);
        bindCopyCodeButtons(bubble);
      }
    });

    messagesContainer.appendChild(typingIndicator);
    scrollToBottom();
  }

  // --- 3. Кнопка «Меню» Telegram и выпадающий список команд (как на скрине) ---
  function openSettingsModal() {
    const sUrl = document.getElementById('settingServerUrl');
    const bToken = document.getElementById('settingBotToken');
    const sKey = document.getElementById('settingApiKey');
    const sModel = document.getElementById('settingModel');
    const sPin = document.getElementById('settingPinCode');
    const sVoice = document.getElementById('settingVoiceAutoplay');

    if (sUrl) sUrl.value = state.settings.serverUrl || '';
    if (bToken) bToken.value = state.settings.botToken || state.settings.masterToken || '';
    if (sKey) sKey.value = state.settings.apiKey || '';
    if (sModel) sModel.value = state.settings.model || 'claude-sonnet-4.6';
    if (sPin) sPin.value = state.settings.pinCode || '';
    if (sVoice) sVoice.checked = state.settings.voiceAutoplay !== false;

    settingsModal.classList.add('active');
  }

  if (btnTopMenu) {
    btnTopMenu.addEventListener('click', openSettingsModal);
  }

  if (btnTgMenu && telegramCommandPopup) {
    btnTgMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      telegramCommandPopup.classList.toggle('active');
    });

    if (btnCloseCmdMenu) {
      btnCloseCmdMenu.addEventListener('click', () => {
        telegramCommandPopup.classList.remove('active');
      });
    }

    document.addEventListener('click', (e) => {
      if (!telegramCommandPopup.contains(e.target) && e.target !== btnTgMenu) {
        telegramCommandPopup.classList.remove('active');
      }
    });

    telegramCommandPopup.querySelectorAll('.command-item').forEach(item => {
      item.addEventListener('click', async () => {
        const cmd = item.getAttribute('data-cmd');
        telegramCommandPopup.classList.remove('active');

        if (cmd === '/settings') {
          openSettingsModal();
        } else if (cmd === '/model') {
          openSettingsModal();
          setTimeout(() => document.getElementById('settingModel').focus(), 150);
        } else if (cmd === '/new') {
          try {
            await fetch(`/api/clear_memory?session_id=${state.currentSessionId}`, { method: 'POST' });
            messagesContainer.querySelectorAll('.message-bubble').forEach(b => b.remove());
            renderOutgoingMessage('/new', []);
            renderIncomingMessage({
              text: '✨ Контекст и память диалога очищены. Начинаем новый диалог с чистого листа!'
            });
          } catch (err) {
            console.error('Failed to clear memory:', err);
          }
        } else {
          // Отправка команды боту (/start, /status, /help)
          renderOutgoingMessage(cmd, []);
          wsClient.send({
            action: 'send_message',
            session_id: state.currentSessionId,
            text: cmd,
            files: [],
            api_key: state.settings.apiKey,
            model: state.settings.model
          });
        }
      });
    });
  }

  // --- 4. Логика Скрепки 📎: Выбор файлов, Drag & Drop, Буфер обмена (Ctrl+V) ---
  btnAttach.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesSelected(Array.from(e.target.files));
      fileInput.value = '';
    }
  });

  // Вставка из буфера обмена (Скриншоты и скопированные файлы)
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData ? e.clipboardData.items : [];
    const files = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleFilesSelected(files);
    }
  });

  // Drag & Drop файлов в окно чата
  const dropZone = document.getElementById('chatWindow');
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.outline = '2px dashed var(--tg-accent-blue)';
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.style.outline = 'none';
    });
  });

  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(Array.from(e.dataTransfer.files));
    }
  });

  function handleFilesSelected(files) {
    files.forEach(file => {
      state.pendingAttachments.push({
        file: file,
        name: file.name,
        size: formatFileSize(file.size),
        type: file.type
      });
    });
    renderAttachmentChips();
    updateActionButton();
  }

  function renderAttachmentChips() {
    if (state.pendingAttachments.length === 0) {
      attachmentPreviewBar.style.display = 'none';
      attachmentPreviewBar.innerHTML = '';
      return;
    }

    attachmentPreviewBar.style.display = 'flex';
    attachmentPreviewBar.innerHTML = '';

    state.pendingAttachments.forEach((att, index) => {
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      const icon = att.type.startsWith('image/') ? '🖼️' : '📄';
      chip.innerHTML = `
        <span>${icon} ${escapeHtml(att.name)}</span>
        <button class="btn-remove-chip" data-index="${index}" title="Удалить">✕</button>
      `;
      chip.querySelector('.btn-remove-chip').addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'));
        state.pendingAttachments.splice(idx, 1);
        renderAttachmentChips();
        updateActionButton();
      });
      attachmentPreviewBar.appendChild(chip);
    });
  }

  // --- 5. Загрузка файлов на сервер (/api/upload) ---
  async function uploadPendingFiles() {
    const uploaded = [];
    for (const att of state.pendingAttachments) {
      const formData = new FormData();
      formData.append('file', att.file);
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          const data = await res.json();
          uploaded.push({
            name: data.filename,
            size: att.size,
            path: data.filepath,
            url: data.url,
            content_type: data.content_type
          });
        }
      } catch (err) {
        console.error('[Upload] Error uploading file:', att.name, err);
      }
    }
    return uploaded;
  }

  // --- 6. Поле ввода сообщения и переключение Send / Mic ---
  messageInput.addEventListener('input', () => {
    // Автоподстройка высоты
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 130) + 'px';
    updateActionButton();
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendTextMessage();
    }
  });

  function updateActionButton() {
    const hasText = messageInput.value.trim().length > 0;
    const hasAttachments = state.pendingAttachments.length > 0;

    if (hasText || hasAttachments) {
      btnAction.textContent = '➤';
      btnAction.title = 'Отправить сообщение';
      btnAction.classList.remove('recording');
    } else {
      btnAction.textContent = '🎙️';
      btnAction.title = 'Голосовое сообщение';
    }
  }

  // Нажатие на кнопку действия (Отправить / Голос)
  btnAction.addEventListener('click', () => {
    if (state.isRecordingVoice) {
      handleToggleVoiceRecording();
      return;
    }
    const hasText = messageInput.value.trim().length > 0;
    const hasAttachments = state.pendingAttachments.length > 0;

    if (hasText || hasAttachments) {
      handleSendTextMessage();
    } else {
      handleToggleVoiceRecording();
    }
  });

  // --- 7. Отправка текстового сообщения ---
  async function handleSendTextMessage() {
    const text = messageInput.value.trim();
    if (!text && state.pendingAttachments.length === 0) return;

    // 1. Показываем сообщение пользователя в UI
    const sentAttachments = [...state.pendingAttachments];
    renderOutgoingMessage(text, sentAttachments);

    // Сброс полей ввода
    messageInput.value = '';
    messageInput.style.height = 'auto';
    state.pendingAttachments = [];
    renderAttachmentChips();
    updateActionButton();

    // 2. Асинхронно заливаем файлы на сервер
    let uploadedMeta = [];
    if (sentAttachments.length > 0) {
      uploadedMeta = await uploadPendingFiles();
    }

    // 3. Отправляем в сокет или по HTTP
    if (wsClient && wsClient.isConnected) {
      wsClient.send({
        type: 'message',
        session_id: state.currentSessionId,
        text: text,
        attachments: uploadedMeta,
        api_key: state.settings.apiKey,
        model: state.settings.model
      });
    } else {
      // Гибридный HTTP REST режим (для надежной работы 24/7)
      if (typingIndicator) {
        typingIndicator.style.display = 'flex';
        const label = typingIndicator.querySelector('span');
        if (label) label.textContent = 'SLUGA думает...';
        scrollToBottom();
      }

      try {
        const httpBase = (state.settings.serverUrl || window.location.origin || '')
          .replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://').replace(/\/ws$/, '');
        
        const res = await fetch(`${httpBase}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: state.currentSessionId,
            text: text,
            files: uploadedMeta,
            token: state.settings.botToken,
            model: state.settings.model,
            api_key: state.settings.apiKey
          })
        });

        if (typingIndicator) typingIndicator.style.display = 'none';

        if (res.ok) {
          const data = await res.json();
          const msg = data.message || {};
          renderIncomingMessage({
            text: msg.content || msg.text || '',
            audio_base64: msg.audio_base64
          });
        } else {
          renderIncomingMessage({
            text: `⚠️ **Сбой сервера (${res.status}):** Не удалось получить ответ агента.`
          });
        }
      } catch (err) {
        if (typingIndicator) typingIndicator.style.display = 'none';
        renderIncomingMessage({
          text: `⚠️ **Ошибка связи:** ${err.message}. Проверьте соединение с сервером.`
        });
      }
    }
  }

  // --- Emoji Picker Telegram ---
  const btnEmoji = document.getElementById('btnEmoji');
  const emojiPickerPopup = document.getElementById('emojiPickerPopup');
  const btnCloseEmojiPopup = document.getElementById('btnCloseEmojiPopup');
  const emojiGrid = document.getElementById('emojiGrid');

  const EMOJI_SETS = {
    faces: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😋','😛','😜','🤪','🤫','🤔','🤐','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐'],
    gestures: ['👍','👎','👏','🙌','🤝','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','✍️','🙏','💪','🦾','👂','👀'],
    tech: ['🤖','⚡','🔥','💡','🚀','💻','🧠','🛠️','⚙️','📊','🔬','🧬','🎯','🔒','🔑','📦','🌐','🛡️','💎','❤️','🖥️','📱','🕹️'],
    symbols: ['✨','🎉','⭐','🌟','💥','💯','✅','❌','⚠️','❓','❗','💬','💭','🔔','🎵','☀️','🌙','☕','🍕','🍔','🏆','🥇','🎁']
  };

  function renderEmojiGrid(category) {
    if (!emojiGrid) return;
    emojiGrid.innerHTML = '';
    const list = EMOJI_SETS[category] || EMOJI_SETS.faces;
    list.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn-item';
      btn.textContent = emoji;
      btn.type = 'button';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        insertEmojiAtCursor(emoji);
      });
      emojiGrid.appendChild(btn);
    });
  }

  function insertEmojiAtCursor(emoji) {
    const start = messageInput.selectionStart || messageInput.value.length;
    const end = messageInput.selectionEnd || messageInput.value.length;
    const text = messageInput.value;
    messageInput.value = text.substring(0, start) + emoji + text.substring(end);
    messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
    messageInput.focus();
    updateActionButton();
  }

  if (btnEmoji && emojiPickerPopup) {
    renderEmojiGrid('faces');

    const toggleEmojiPicker = (e) => {
      e.stopPropagation();
      emojiPickerPopup.classList.toggle('active');
      if (telegramCommandPopup) telegramCommandPopup.classList.remove('active');
    };

    btnEmoji.addEventListener('click', toggleEmojiPicker);

    if (btnCloseEmojiPopup) {
      btnCloseEmojiPopup.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPickerPopup.classList.remove('active');
      });
    }

    emojiPickerPopup.querySelectorAll('.emoji-tab-btn').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPickerPopup.querySelectorAll('.emoji-tab-btn').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const cat = tab.getAttribute('data-cat');
        renderEmojiGrid(cat);
      });
    });

    document.addEventListener('click', (e) => {
      if (emojiPickerPopup && !emojiPickerPopup.contains(e.target) && e.target !== btnEmoji) {
        emojiPickerPopup.classList.remove('active');
      }
    });
  }

  // --- 8. Запись и отправка голосового сообщения ---
  const inputPanel = document.querySelector('.input-panel');
  const voiceRecordingHud = document.getElementById('voiceRecordingHud');
  const voiceRecordingDuration = document.getElementById('voiceRecordingDuration');
  const voiceRecordingLiveText = document.getElementById('voiceRecordingLiveText');
  const btnCancelRecording = document.getElementById('btnCancelRecording');
  const btnSendRecording = document.getElementById('btnSendRecording');

  async function finishAndSendVoiceRecording() {
    if (!state.isRecordingVoice) return;
    state.isRecordingVoice = false;

    if (inputPanel) inputPanel.classList.remove('recording-mode');
    btnAction.classList.remove('recording');
    btnAction.textContent = '🎙️';
    if (voiceRecordingHud) voiceRecordingHud.style.display = 'none';
    messageInput.style.display = 'block';
    messageInput.focus();

    const recordResult = await voiceManager.stopRecording();
    if (recordResult && recordResult.base64) {
      renderOutgoingVoice(recordResult.duration || 1);

      // Отправка голосового на сервер
      wsClient.send({
        action: 'send_voice',
        type: 'voice',
        session_id: state.currentSessionId,
        audio_base64: recordResult.base64,
        mime_type: recordResult.mimeType,
        api_key: state.settings.apiKey,
        model: state.settings.model
      });
    } else if (recordResult && recordResult.liveTranscript) {
      messageInput.value = recordResult.liveTranscript;
      updateActionButton();
      handleSendTextMessage();
    }
  }

  function cancelVoiceRecording() {
    if (!state.isRecordingVoice) return;
    state.isRecordingVoice = false;
    voiceManager.cancelRecording();

    if (inputPanel) inputPanel.classList.remove('recording-mode');
    btnAction.classList.remove('recording');
    btnAction.textContent = '🎙️';
    if (voiceRecordingHud) voiceRecordingHud.style.display = 'none';
    messageInput.style.display = 'block';
    messageInput.focus();
  }

  if (btnCancelRecording) {
    btnCancelRecording.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelVoiceRecording();
    });
  }

  if (btnSendRecording) {
    btnSendRecording.addEventListener('click', async (e) => {
      e.stopPropagation();
      await finishAndSendVoiceRecording();
    });
  }

  async function handleToggleVoiceRecording() {
    if (!state.isRecordingVoice) {
      if (voiceRecordingLiveText) voiceRecordingLiveText.textContent = 'Слушаю... Говорите';
      if (voiceRecordingDuration) voiceRecordingDuration.textContent = '0:00';

      const ok = await voiceManager.startRecording((seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        if (voiceRecordingDuration) voiceRecordingDuration.textContent = timeStr;
        btnAction.title = `Идет запись: ${timeStr} (нажмите для отправки)`;
      }, (liveText) => {
        if (voiceRecordingLiveText && liveText) {
          voiceRecordingLiveText.textContent = liveText;
        }
      });

      if (ok) {
        state.isRecordingVoice = true;
        if (inputPanel) inputPanel.classList.add('recording-mode');
        btnAction.classList.add('recording');
        btnAction.textContent = '⏹️';
        if (voiceRecordingHud) voiceRecordingHud.style.display = 'flex';
        messageInput.style.display = 'none';
      }
    } else {
      await finishAndSendVoiceRecording();
    }
  }

  // Регистрация PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.log('[PWA] ServiceWorker info:', err);
    });
  }


  // --- 9. Рендеринг пузырей сообщений ---
  function renderOutgoingMessage(text, attachments, isRestoring = false) {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble message-out';

    let attHtml = '';
    if (attachments && attachments.length > 0) {
      attachments.forEach(att => {
        if (att.type.startsWith('image/')) {
          const previewUrl = URL.createObjectURL(att.file);
          attHtml += `<img src="${previewUrl}" class="image-preview-msg" alt="Вложение">`;
        } else {
          attHtml += `
            <div class="attachment-card">
              <div class="attachment-icon">📄</div>
              <div class="attachment-details">
                <div class="attachment-name">${escapeHtml(att.name)}</div>
                <div class="attachment-size">${att.size}</div>
              </div>
            </div>
          `;
        }
      });
    }

    bubble.innerHTML = `
      ${attHtml}
      ${text ? `<div class="message-text">${formatMarkdown(text)}</div>` : ''}
      <div class="message-meta">
        <span>${formatTime(new Date())}</span>
        <span class="checkmarks">✓✓</span>
      </div>
    `;

    messagesContainer.insertBefore(bubble, typingIndicator);
    bindCopyCodeButtons(bubble);
    scrollToBottom();
    // Автоматическое сохранение исходящего сообщения в постоянное хранилище SlugaStorage
    if (window.SlugaStorage && !isRestoring) {
      window.SlugaStorage.saveMessage(state.currentSessionId, {
        isOutgoing: true,
        text: text,
        time: formatTime(new Date())
      });
    }

  }

  function renderOutgoingVoice(duration) {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble message-out';
    bubble.innerHTML = `
      <div class="voice-bubble">
        <button class="btn-play-voice">▶</button>
        <div class="voice-waveform">
          <div class="waveform-bar" style="height: 40%;"></div>
          <div class="waveform-bar" style="height: 70%;"></div>
          <div class="waveform-bar" style="height: 100%;"></div>
          <div class="waveform-bar" style="height: 50%;"></div>
          <div class="waveform-bar" style="height: 80%;"></div>
          <div class="waveform-bar" style="height: 30%;"></div>
        </div>
        <span class="voice-time">0:${duration < 10 ? '0' : ''}${duration}</span>
      </div>
      <div class="message-meta">
        <span>${formatTime(new Date())}</span>
        <span class="checkmarks">✓✓</span>
      </div>
    `;
    messagesContainer.insertBefore(bubble, typingIndicator);
    scrollToBottom();
  }

  function renderIncomingMessage(payload, isRestoring = false) {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble message-in';

    let contentHtml = '';

    // Голосовое воспроизведение
    if (payload.audio_base64) {
      contentHtml += `
        <div class="voice-bubble">
          <button class="btn-play-voice" data-audio="${payload.audio_base64}">▶</button>
          <div class="voice-waveform">
            <div class="waveform-bar" style="height: 60%;"></div>
            <div class="waveform-bar" style="height: 100%;"></div>
            <div class="waveform-bar" style="height: 80%;"></div>
            <div class="waveform-bar" style="height: 40%;"></div>
            <div class="waveform-bar" style="height: 90%;"></div>
          </div>
          <span class="voice-time">Голос</span>
        </div>
      `;
    }

    if (payload.text) {
      contentHtml += `<div class="message-text">${formatMarkdown(payload.text)}</div>`;
    }

    bubble.innerHTML = `
      ${contentHtml}
      <div class="message-meta">
        <span>${formatTime(new Date())}</span>
        <span class="checkmarks">✓✓</span>
      </div>
    `;

    messagesContainer.insertBefore(bubble, typingIndicator);
    bindCopyCodeButtons(bubble);

    // Привязка кнопки Play для голосового
    const playBtn = bubble.querySelector('.btn-play-voice');
    if (playBtn && payload.audio_base64) {
      playBtn.addEventListener('click', () => {
        voiceManager.playBase64Audio(payload.audio_base64, 'audio/wav');
      });
    }

    // Автоматическое сохранение входящего сообщения в постоянное хранилище SlugaStorage
    if (window.SlugaStorage && !isRestoring) {
      window.SlugaStorage.saveMessage(state.currentSessionId, {
        isOutgoing: false,
        text: payload.text || '',
        audio_base64: payload.audio_base64 || null,
        time: formatTime(new Date())
      });
    }

    scrollToBottom();
  }

  // --- 10. Форматирование Markdown и блоков кода Telegram ---
  function formatMarkdown(rawText) {
    if (!rawText) return '';
    let text = escapeHtml(rawText);

    // Тройные обратные кавычки: Блоки кода с кнопкой копирования
    text = text.replace(/```([a-zA-Z0-9_\-\+]*)\n?([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang.trim() || 'code';
      return `
        <div class="code-block-wrapper">
          <div class="code-header">
            <span>${language}</span>
            <button class="btn-copy-code" data-code="${encodeURIComponent(code)}">Копировать</button>
          </div>
          <pre class="code-content"><code>${code}</code></pre>
        </div>
      `;
    });

    // Одинарные обратные кавычки: `inline code`
    text = text.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 5px; border-radius: 4px; font-family: var(--font-mono); font-size: 13px;">$1</code>');

    // Жирный текст **текст**
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Курсив *текст*
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Переводы строк
    text = text.replace(/\n/g, '<br>');

    return text;
  }

  function bindCopyCodeButtons(container) {
    container.querySelectorAll('.btn-copy-code').forEach(btn => {
      btn.addEventListener('click', () => {
        const rawCode = decodeURIComponent(btn.getAttribute('data-code'));
        navigator.clipboard.writeText(rawCode).then(() => {
          const orig = btn.textContent;
          btn.textContent = 'Скопировано!';
          setTimeout(() => { btn.textContent = orig; }, 2000);
        });
      });
    });
  }

  // --- 11. Настройки и безопасность ---
  const closeSettings = () => settingsModal.classList.remove('active');
  btnCloseSettings.addEventListener('click', closeSettings);
  btnCancelSettings.addEventListener('click', closeSettings);

  btnSaveSettings.addEventListener('click', () => {
    try {
      const sUrlEl = document.getElementById('settingServerUrl');
      const bTokenEl = document.getElementById('settingBotToken');
      const sKeyEl = document.getElementById('settingApiKey');
      const sModelEl = document.getElementById('settingModel');
      const sPinEl = document.getElementById('settingPinCode');
      const sVoiceEl = document.getElementById('settingVoiceAutoplay');

      let sUrl = sUrlEl ? sUrlEl.value.trim() : '';
      if (sUrl) {
        sUrl = sUrl.replace(/^wss?:\/\/https?:\/\//i, 'wss://')
                   .replace(/^http:\/\//i, 'ws://')
                   .replace(/^https:\/\//i, 'wss://');
        if (!/^wss?:\/\//i.test(sUrl)) {
          sUrl = 'wss://' + sUrl;
        }
        if (!sUrl.endsWith('/ws')) {
          sUrl = sUrl.replace(/\/+$/, '') + '/ws';
        }
        if (sUrlEl) sUrlEl.value = sUrl;
      }
      const bToken = bTokenEl ? bTokenEl.value.trim() : '';
      const apiKey = sKeyEl ? sKeyEl.value.trim() : '';
      const model = sModelEl ? sModelEl.value : 'claude-sonnet-4-6';
      const pinCode = sPinEl ? sPinEl.value.trim() : '';
      const voiceAutoplay = sVoiceEl ? sVoiceEl.checked : true;

      state.settings.serverUrl = sUrl;
      state.settings.botToken = bToken;
      state.settings.masterToken = bToken;
      state.settings.apiKey = apiKey;
      state.settings.model = model;
      state.settings.pinCode = pinCode;
      state.settings.voiceAutoplay = voiceAutoplay;

      if (window.SlugaStorage) {
        window.SlugaStorage.saveSettings(state.settings);
      }
      localStorage.setItem('sluga_server_url', sUrl);
      localStorage.setItem('sluga_bot_token', bToken);
      localStorage.setItem('sluga_master_token', bToken);
      localStorage.setItem('sluga_api_key', apiKey);
      localStorage.setItem('sluga_model', model);
      localStorage.setItem('sluga_pin_code', pinCode);
      localStorage.setItem('sluga_voice_autoplay', voiceAutoplay);

      closeSettings();

      // Немедленный перезапуск WebSocket с новым адресом и токеном
      initWebSocket();

      // Если сокет активен, отправляем обновление серверу
      if (wsClient && wsClient.isConnected) {
        wsClient.send({ action: 'update_key', key: apiKey });
        wsClient.send({ action: 'update_model', model: model });
      }
    } catch (e) {
      console.error('[Settings] Error saving settings:', e);
      closeSettings();
    }
  });


  // --- Вспомогательные утилиты ---
  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // --- 10. Восстановление истории чата из SlugaStorage при запуске/переключении ---
  function restoreChatMessages(sessionId) {
    if (!window.SlugaStorage) return;
    // Очищаем текущие пузыри (кроме индикатора набора)
    const bubbles = messagesContainer.querySelectorAll('.message-bubble');
    bubbles.forEach(b => b.remove());

    const savedMsgs = window.SlugaStorage.getMessages(sessionId);
    if (savedMsgs && savedMsgs.length > 0) {
      savedMsgs.forEach(m => {
        if (m.isOutgoing) {
          renderOutgoingMessage(m.text, [], true);
        } else {
          renderIncomingMessage({
            text: m.text,
            audio_base64: m.audio_base64
          }, true);
        }
      });
    } else {
      // Приветственное сообщение
      renderIncomingMessage({
        text: "👋 **Привет! Я SlugaGram.**\n\nВаш персональный автономный ИИ-ассистент готов к работе.\nВся история наших диалогов теперь **100% сохраняется локально** и не пропадёт при перезагрузке страницы."
      }, true);
    }
    scrollToBottom();
  }

  // Загружаем сохраненную историю при старте
  restoreChatMessages(state.currentSessionId);

  // --- Функция тестирования подключения ---
  window.testSlugaConnection = async function() {
    const testResultEl = document.getElementById('connectionTestResult');
    const inputUrl = document.getElementById('settingServerUrl');
    const inputToken = document.getElementById('settingBotToken');
    const rawUrl = (inputUrl ? inputUrl.value : state.settings.serverUrl || window.location.origin || '').trim();
    const token = (inputToken ? inputToken.value : (state.settings.botToken || '')).trim();

    if (!testResultEl) return;
    testResultEl.textContent = '⏱️ Проверяю подключение...';
    testResultEl.style.color = '#aaa';

    const httpBase = toHttpUrl(rawUrl);

    try {
      const authUrl = `${httpBase}/api/auth_check?token=${encodeURIComponent(token)}`;
      const resp = await fetch(authUrl, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json();
        const model = data.model || 'gpt-5.6-sol';
        testResultEl.textContent = `✅ Сервер онлайн! Токен принят. Модель: ${model} (24/7)`;
        testResultEl.style.color = '#4fae4e';
        return;
      } else if (resp.status === 403) {
        testResultEl.textContent = '❌ Неверный Bot Token (код 403 Forbidden).';
        testResultEl.style.color = '#e53935';
        return;
      } else {
        testResultEl.textContent = `⚠️ Ответ сервера HTTP ${resp.status}`;
        testResultEl.style.color = '#ff9800';
        return;
      }
    } catch (e) {
      testResultEl.textContent = `❌ Ошибка связи: ${e.message}`;
      testResultEl.style.color = '#e53935';
      return;
    }
  };

  const _legacyTestSlugaConnection = async function() {
    const testResultEl = document.getElementById('connectionTestResult');
    const inputUrl = document.getElementById('settingServerUrl');
    const inputToken = document.getElementById('settingBotToken');
    let wsUrl = (inputUrl ? inputUrl.value : state.settings.serverUrl || '').trim();
    const token = (inputToken ? inputToken.value : (state.settings.botToken || state.settings.masterToken || '')).trim();

    if (!testResultEl) return;
    if (!wsUrl) {
      testResultEl.textContent = '⚠️ Сначала введите адрес WebSocket сервера.';
      testResultEl.style.color = '#e6a817';
      return;
    }

    // Автоматическая нормализация (исправляет wss://https://... и опечатки протокола)
    wsUrl = wsUrl.replace(/^wss?:\/\/https?:\/\//i, 'wss://')
                 .replace(/^http:\/\//i, 'ws://')
                 .replace(/^https:\/\//i, 'wss://');
    if (!/^wss?:\/\//i.test(wsUrl)) {
      wsUrl = 'wss://' + wsUrl;
    }
    if (!wsUrl.endsWith('/ws')) {
      wsUrl = wsUrl.replace(/\/+$/, '') + '/ws';
    }
    if (inputUrl) inputUrl.value = wsUrl;

    testResultEl.textContent = '⏱️ Проверяю подключение...';
    testResultEl.style.color = '#aaa';

    // Проверяем HTTP /health
    const httpUrl = wsUrl.replace(/^ws:\/\//i, 'http://')
                         .replace(/^wss:\/\//i, 'https://')
                         .replace(/\/ws$/i, '') + '/health';
    try {
      const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch (httpErr) {
      if (httpErr.name === 'TimeoutError') {
        testResultEl.textContent = '⏱️ Нет ответа 5с — проверьте адрес WSS или используйте Cloudflare Tunnel.';
        testResultEl.style.color = '#e53935';
      } else {
        testResultEl.textContent = `❌ HTTP ошибка: ${httpErr.message}. Если Beget — используйте Cloudflare Tunnel.`;
        testResultEl.style.color = '#e53935';
      }
      return;
    }

    // HTTP ответил — тестируем WebSocket
    const fullUrl = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
    let testWs;
    const timeout = setTimeout(() => {
      if (testWs) testWs.close();
      testResultEl.textContent = '⏱️ WS: нет ответа 5с — проверьте токен или адрес.';
      testResultEl.style.color = '#e53935';
    }, 5000);

    try {
      testWs = new WebSocket(fullUrl);
      testWs.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.event === 'authenticated') {
            clearTimeout(timeout);
            const model = data.model || 'модель не определена';
            testResultEl.textContent = `✅ Сервер онлайн! Токен принят. Модель: ${model}`;
            testResultEl.style.color = '#4fae4e';
            testWs.close();
          } else if (data.event === 'error' || data.error) {
            clearTimeout(timeout);
            testResultEl.textContent = `❌ Неверный токен или ошибка: ${data.error || data.event}`;
            testResultEl.style.color = '#e53935';
            testWs.close();
          }
        } catch (e) {}
      };
      testWs.onclose = (ev) => {
        clearTimeout(timeout);
        if (ev.code === 4003) {
          testResultEl.textContent = '❌ Неверный Bot Token (код 4003 Forbidden).';
          testResultEl.style.color = '#e53935';
        }
      };
    } catch (e) {
      clearTimeout(timeout);
      testResultEl.textContent = `❌ Ошибка WS: ${e.message}`;
      testResultEl.style.color = '#e53935';
    }
  };

});
