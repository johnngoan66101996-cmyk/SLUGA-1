/**
 * SlugaGram Persistent Storage Manager
 * Обеспечивает 100% сохранность истории чатов, сессий и настроек при перезагрузке (F5),
 * перезапуске приложения или закрытии окна.
 */

const SlugaStorage = {
  SETTINGS_KEY: 'slugagram_settings',
  CHATS_KEY: 'slugagram_chats',
  MSG_PREFIX: 'slugagram_msg_',

  // Дефолтные настройки
  getDefaultSettings() {
    return {
      serverUrl: '',
      botToken: '',
      model: 'gpt-5.6-sol',
      voiceAutoplay: true,
      pinCode: '',
      isPaired: false       // true после первого успешного подключения
    };
  },

  getSettings() {
    try {
      const raw = localStorage.getItem(this.SETTINGS_KEY);
      if (raw) {
        const s = { ...this.getDefaultSettings(), ...JSON.parse(raw) };
        if (s.model === 'claude-sonnet-4-6') {
          s.model = 'gpt-5.6-sol';
        }
        return s;
      }
    } catch (e) {
      console.warn('[Storage] Ошибка чтения настроек:', e);
    }
    return this.getDefaultSettings();
  },

  saveSettings(settings) {
    try {
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch (e) {
      console.error('[Storage] Ошибка записи настроек:', e);
      return false;
    }
  },

  // Дефолтный список чатов
  getDefaultChats() {
    return [
      {
        id: 'sluga_core',
        title: '🤖 SLUGA Основной',
        subtitle: 'Автономный ИИ-инженер',
        avatar: '🤖',
        pinned: true,
        lastMessage: 'Система готова к работе',
        time: 'только что'
      },
      {
        id: 'sluga_coder',
        title: '💻 Архитектор & Кодер',
        subtitle: 'Глубокий рефакторинг и код',
        avatar: '💻',
        pinned: false,
        lastMessage: 'Готов писать и проверять код',
        time: '12:00'
      },
      {
        id: 'sluga_terminal',
        title: '⚡ Терминал & DevOps',
        subtitle: 'Запуск команд и диагностика',
        avatar: '⚡',
        pinned: false,
        lastMessage: 'PowerShell HUD активен',
        time: 'вчера'
      },
      {
        id: 'sluga_notes',
        title: '📁 Избранное / Заметки',
        subtitle: 'Личное хранилище промптов',
        avatar: '⭐',
        pinned: false,
        lastMessage: 'Сохраненные сниппеты',
        time: '01.09'
      }
    ];
  },

  getChats() {
    try {
      const raw = localStorage.getItem(this.CHATS_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[Storage] Ошибка чтения чатов:', e);
    }
    const def = this.getDefaultChats();
    this.saveChats(def);
    return def;
  },

  saveChats(chats) {
    try {
      localStorage.setItem(this.CHATS_KEY, JSON.stringify(chats));
    } catch (e) {
      console.error('[Storage] Ошибка сохранения чатов:', e);
    }
  },

  updateChatLastMessage(sessionId, text, timeStr) {
    const chats = this.getChats();
    const chat = chats.find(c => c.id === sessionId);
    if (chat) {
      chat.lastMessage = text.length > 50 ? text.substring(0, 47) + '...' : text;
      chat.time = timeStr || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.saveChats(chats);
    }
  },

  // Сохранение и извлечение сообщений для конкретного чата
  getMessages(sessionId) {
    try {
      const raw = localStorage.getItem(this.MSG_PREFIX + sessionId);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[Storage] Ошибка чтения истории чата ' + sessionId, e);
    }
    return [];
  },

  saveMessage(sessionId, msgObj) {
    try {
      const msgs = this.getMessages(sessionId);
      msgs.push(msgObj);
      // Ограничение до 500 последних сообщений на чат для экономии памяти
      if (msgs.length > 500) {
        msgs.shift();
      }
      localStorage.setItem(this.MSG_PREFIX + sessionId, JSON.stringify(msgs));
      this.updateChatLastMessage(sessionId, msgObj.text || (msgObj.isVoice ? '🎙️ Голосовое сообщение' : '📄 Вложение'));
    } catch (e) {
      console.error('[Storage] Ошибка сохранения сообщения:', e);
    }
  },

  clearMessages(sessionId) {
    try {
      localStorage.removeItem(this.MSG_PREFIX + sessionId);
      this.updateChatLastMessage(sessionId, 'История очищена');
      return true;
    } catch (e) {
      return false;
    }
  }
};

window.SlugaStorage = SlugaStorage;
