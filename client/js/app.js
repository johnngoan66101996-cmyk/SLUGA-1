/**
 * SLUGA Telegram Messenger — Main Application Controller
 * Реализует логику мессенджера: чаты, скрепку, drag&drop, буфер обмена, блоки кода, TTS
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- Состояние приложения ---
  const state = {
    currentSessionId: 'sluga_core',
    pendingAttachments: [], // [{ name, size, type, file, serverPath }]
    isRecordingVoice: false,
    settings: {
      serverUrl: localStorage.getItem('sluga_server_url') || '',
      masterToken: localStorage.getItem('sluga_master_token') || '',
      apiKey: localStorage.getItem('sluga_api_key') || '',
      model: localStorage.getItem('sluga_model') || 'claude-sonnet-4-6',
      pinCode: localStorage.getItem('sluga_pin_code') || '',
      voiceAutoplay: localStorage.getItem('sluga_voice_autoplay') !== 'false'
    }
  };

  // --- Элементы интерфейса ---
  const appContainer = document.getElementById('appContainer');
  const messagesContainer = document.getElementById('messagesContainer');
  const typingIndicator = document.getElementById('typingIndicator');
  const messageInput = document.getElementById('messageInput');
  const btnAction = document.getElementById('btnAction');
  const btnAttach = document.getElementById('btnAttach');
  const fileInput = document.getElementById('fileInput');
  const attachmentPreviewBar = document.getElementById('attachmentPreviewBar');
  const headerTitle = document.getElementById('headerTitle');
  const headerAvatar = document.getElementById('headerAvatar');
  const headerStatus = document.getElementById('headerStatus');
  const btnTopMenu = document.getElementById('btnTopMenu');
  const btnTgMenu = document.getElementById('btnTgMenu');
  const telegramCommandPopup = document.getElementById('telegramCommandPopup');
  const btnCloseCmdMenu = document.getElementById('btnCloseCmdMenu');
  const settingsModal = document.getElementById('settingsModal');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const btnCancelSettings = document.getElementById('btnCancelSettings');
  const btnSaveSettings = document.getElementById('btnSaveSettings');
  const pinLockModal = document.getElementById('pinLockModal');
  const inputUnlockPin = document.getElementById('inputUnlockPin');
  const btnUnlockApp = document.getElementById('btnUnlockApp');
  const pinErrorMsg = document.getElementById('pinErrorMsg');

  // --- Инстансы сокетов и голоса ---
  const wsClient = new SlugaWebSocketClient();
  const voiceManager = new SlugaVoiceManager();

  // --- 1. Проверка защитного PIN-кода (экран блокировки) ---
  if (state.settings.pinCode) {
    pinLockModal.classList.add('active');
    inputUnlockPin.focus();

    const checkPin = () => {
      if (inputUnlockPin.value === state.settings.pinCode) {
        pinLockModal.classList.remove('active');
        pinErrorMsg.style.display = 'none';
        inputUnlockPin.value = '';
      } else {
        pinErrorMsg.style.display = 'block';
        inputUnlockPin.value = '';
        inputUnlockPin.focus();
      }
    };

    btnUnlockApp.addEventListener('click', checkPin);
    inputUnlockPin.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') checkPin();
    });
  }

  // --- 2. Инициализация WebSocket ---
  const initWebSocket = () => {
    headerStatus.textContent = 'подключение к серверу...';
    wsClient.connect(state.settings.serverUrl, state.settings.masterToken);
  };

  wsClient.on('connect', () => {
    headerStatus.textContent = 'онлайн • защищенный WebSocket';
    headerStatus.style.color = '#4fae4e';
  });

  wsClient.on('disconnect', () => {
    headerStatus.textContent = 'переподключение...';
    headerStatus.style.color = '#e53935';
  });

  // Обработчик успешной авторизации по токену
  wsClient.on('authenticated', (payload) => {
    const model = payload.model || payload.liteai_model || 'модель не определена';
    headerStatus.textContent = `✅ онлайн • ${model}`;
    headerStatus.style.color = '#4fae4e';
    // Обновляем поле модели в форме настроек, если она открыта
    const inputModel = document.getElementById('inputModel');
    if (inputModel && !inputModel.value) inputModel.value = model;
    // Скрываем индикатор теста, если он виден
    const testResultEl = document.getElementById('connectionTestResult');
    if (testResultEl) {
      testResultEl.textContent = `✅ Сервер онлайн! Токен принят. Модель: ${model}`;
      testResultEl.style.color = '#4fae4e';
    }
    console.log('[WS] Авторизация успешна:', payload);
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

  initWebSocket();

  // --- 3. Кнопка «Меню» Telegram и выпадающий список команд (как на скрине) ---
  function openSettingsModal() {
    const inputUrl = document.getElementById('settingServerUrl');
    if (inputUrl) inputUrl.value = state.settings.serverUrl;
    const inputToken = document.getElementById('settingMasterToken');
    if (inputToken) inputToken.value = state.settings.masterToken;
    document.getElementById('settingApiKey').value = state.settings.apiKey;
    document.getElementById('settingModel').value = state.settings.model;
    document.getElementById('settingPinCode').value = state.settings.pinCode;
    document.getElementById('settingVoiceAutoplay').checked = state.settings.voiceAutoplay;
    const testResultEl = document.getElementById('connectionTestResult');
    if (testResultEl) testResultEl.textContent = '';
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

    // 3. Отправляем в сокет серверу
    wsClient.send({
      type: 'message',
      session_id: state.currentSessionId,
      text: text,
      attachments: uploadedMeta,
      api_key: state.settings.apiKey,
      model: state.settings.model
    });
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
  const voiceRecordingHud = document.getElementById('voiceRecordingHud');
  const voiceRecordingDuration = document.getElementById('voiceRecordingDuration');
  const voiceRecordingLiveText = document.getElementById('voiceRecordingLiveText');
  const btnCancelRecording = document.getElementById('btnCancelRecording');

  if (btnCancelRecording) {
    btnCancelRecording.addEventListener('click', (e) => {
      e.stopPropagation();
      voiceManager.cancelRecording();
      state.isRecordingVoice = false;
      btnAction.classList.remove('recording');
      btnAction.textContent = '🎙️';
      if (voiceRecordingHud) voiceRecordingHud.style.display = 'none';
      messageInput.style.display = 'block';
      messageInput.focus();
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
        btnAction.classList.add('recording');
        btnAction.textContent = '⏹️';
        if (voiceRecordingHud) voiceRecordingHud.style.display = 'flex';
        messageInput.style.display = 'none';
      }
    } else {
      btnAction.classList.remove('recording');
      btnAction.textContent = '🎙️';
      state.isRecordingVoice = false;
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
  }

  // Регистрация PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.log('[PWA] ServiceWorker info:', err);
    });
  }


  // --- 9. Рендеринг пузырей сообщений ---
  function renderOutgoingMessage(text, attachments) {
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

  function renderIncomingMessage(payload) {
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
    const inputUrl = document.getElementById('settingServerUrl');
    if (inputUrl) state.settings.serverUrl = inputUrl.value.trim();
    const inputToken = document.getElementById('settingMasterToken');
    if (inputToken) state.settings.masterToken = inputToken.value.trim();

    state.settings.apiKey = document.getElementById('settingApiKey').value.trim();
    state.settings.model = document.getElementById('settingModel').value;
    state.settings.pinCode = document.getElementById('settingPinCode').value.trim();
    state.settings.voiceAutoplay = document.getElementById('settingVoiceAutoplay').checked;

    localStorage.setItem('sluga_server_url', state.settings.serverUrl);
    localStorage.setItem('sluga_master_token', state.settings.masterToken);
    localStorage.setItem('sluga_api_key', state.settings.apiKey);
    localStorage.setItem('sluga_model', state.settings.model);
    localStorage.setItem('sluga_pin_code', state.settings.pinCode);
    localStorage.setItem('sluga_voice_autoplay', state.settings.voiceAutoplay);

    closeSettings();

    // Отправляем серверу обновление ключа и модели
    wsClient.send({
      action: 'update_key',
      key: state.settings.apiKey
    });
    wsClient.send({
      action: 'update_model',
      model: state.settings.model
    });

    initWebSocket();
  });

  // --- Функция тестирования подключения ---
  window.testSlugaConnection = async function(urlOverride, tokenOverride) {
    const testResultEl = document.getElementById('connectionTestResult');
    const inputUrl = document.getElementById('settingServerUrl');
    const inputToken = document.getElementById('settingMasterToken');
    const wsUrl = (urlOverride || (inputUrl ? inputUrl.value : '') || state.settings.serverUrl || '').trim();
    const token = (tokenOverride || (inputToken ? inputToken.value : '') || state.settings.masterToken || '').trim();

    if (!testResultEl) return;
    if (!wsUrl) {
      testResultEl.textContent = '⚠️ Сначала введите адрес WebSocket сервера.';
      testResultEl.style.color = '#e6a817';
      return;
    }

    testResultEl.textContent = '⏱️ Проверяю подключение...';
    testResultEl.style.color = '#aaa';

    // Сначала проверяем HTTP /health
    const httpUrl = wsUrl.replace(/^wss?:\/\//, (p) => p.startsWith('wss') ? 'https://' : 'http://').replace('/ws', '') + '/health';
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
    } catch(e) {
      clearTimeout(timeout);
      testResultEl.textContent = `❌ Ошибка WS: ${e.message}`;
      testResultEl.style.color = '#e53935';
    }
  };


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
});
