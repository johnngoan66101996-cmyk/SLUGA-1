/**
 * SlugaWebSocketClient — Отказоустойчивый WebSocket-клиент SLUGA v2.0
 * ✅ Автопрефикс URL (можно вводить IP:PORT без ws://)
 * ✅ Heartbeat ping/pong каждые 25 секунд
 * ✅ Экспоненциальный backoff при реконнекте (до 30 попыток)
 * ✅ События: connect, disconnect, reconnecting, authenticated, message, chunk, status, error, pong
 * ✅ getConnectionInfo() — текущий статус, latency, модель, uptime
 */
class SlugaWebSocketClient {
  constructor() {
    this.ws = null;
    this.url = '';
    this.token = '';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 30;
    this.reconnectDelay = 2000;
    this.isConnected = false;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._pingTs = null;
    this.latencyMs = null;
    this.lastConnectedAt = null;
    this.serverModel = null;
    this.serverName = null;
    this._destroyed = false;

    this.handlers = {
      message: [],
      chunk: [],
      status: [],
      error: [],
      connect: [],
      disconnect: [],
      reconnecting: [],
      authenticated: [],
      pong: []
    };
  }

  /**
   * Нормализует URL: добавляет ws:// если нет схемы, добавляет /ws если нет пути.
   * Примеры:
   *   "77.222.40.84:8080"      → "ws://77.222.40.84:8080/ws"
   *   "localhost:8080"         → "ws://localhost:8080/ws"
   *   "myserver.com"           → "ws://myserver.com/ws"
   *   "wss://myserver.com/ws" → "wss://myserver.com/ws" (без изменений)
   */
  static normalizeUrl(rawUrl) {
    let url = (rawUrl || '').trim();
    if (!url) return '';
    const isHttps = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
    // Добавляем схему если нет
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = (isHttps ? 'wss://' : 'ws://') + url;
    } else if (isHttps && url.startsWith('ws://')) {
      url = 'wss://' + url.slice(5);
    }
    // Добавляем /ws если путь отсутствует или только /
    try {
      const parsed = new URL(url);
      if (!parsed.pathname || parsed.pathname === '/') {
        parsed.pathname = '/ws';
      }
      return parsed.toString();
    } catch (e) {
      return url;
    }
  }

  /**
   * Подключиться к серверу.
   * @param {string} url    - адрес сервера (ws://, wss://, или просто IP:PORT)
   * @param {string} token  - Bot Token для авторизации
   */
  connect(url, token = '') {
    if (this._destroyed) return;
    const normalizedUrl = SlugaWebSocketClient.normalizeUrl(url);
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN && this.url === normalizedUrl && this.token === token) {
      return;
    }
    this.url = normalizedUrl;
    this.token = token;
    this.reconnectAttempts = 0;
    this._clearTimers();
    this._openSocket();
  }

  _openSocket() {
    if (this._destroyed) return;
    this._clearTimers();
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      try { oldWs.close(1000, 'Replaced'); } catch (_) {}
    }

    try {
      let fullUrl = this.url;
      if (this.token) {
        const delimiter = fullUrl.includes('?') ? '&' : '?';
        fullUrl = `${fullUrl}${delimiter}token=${encodeURIComponent(this.token)}`;
      }

      const currentWs = new WebSocket(fullUrl);
      this.ws = currentWs;

      currentWs.onopen = () => {
        if (this.ws !== currentWs) return;
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.lastConnectedAt = new Date();
        this.emit('connect', { url: this.url });
        this._startHeartbeat();
      };

      currentWs.onmessage = (event) => {
        if (this.ws !== currentWs) return;
        try {
          const data = JSON.parse(event.data);
          this._handleIncoming(data);
        } catch (err) {
          console.error('[WS] JSON parse error:', event.data, err);
        }
      };

      currentWs.onerror = (err) => {
        if (this.ws !== currentWs) return;
        this.emit('error', { type: 'socket_error', detail: err });
      };

      currentWs.onclose = (event) => {
        if (this.ws !== currentWs) return;
        this.isConnected = false;
        this._stopHeartbeat();
        this.emit('disconnect', { code: event.code, reason: event.reason });
        if (!this._destroyed) {
          this._scheduleReconnect();
        }
      };
    } catch (e) {
      console.error('[WS] Init failed:', e);
      this.emit('error', { type: 'init_error', detail: e });
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._destroyed || this.reconnectAttempts >= this.maxReconnectAttempts) return;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(1.4, this.reconnectAttempts - 1), 12000);
    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delayMs: Math.round(delay)
    });
    this._reconnectTimer = setTimeout(() => this._openSocket(), delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this._pingTs = Date.now();
        this.ws.send(JSON.stringify({ action: 'ping' }));
      }
    }, 25000);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _clearTimers() {
    this._stopHeartbeat();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _handleIncoming(payload) {
    const type = payload.type || payload.event || 'message';

    if (type === 'pong') {
      if (this._pingTs) {
        this.latencyMs = Date.now() - this._pingTs;
        this._pingTs = null;
      }
      this.emit('pong', { latencyMs: this.latencyMs });
      return;
    }

    if (type === 'authenticated') {
      this.serverModel = payload.model || payload.liteai_model || null;
      this.serverName = payload.bot_name || 'SLUGA';
      this.emit('authenticated', payload);
      return;
    }

    if (type === 'chunk') { this.emit('chunk', payload); return; }
    if (type === 'status') { this.emit('status', payload); return; }
    if (type === 'error')  { this.emit('error', payload); return; }

    this.emit('message', payload);
  }

  send(data) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Socket not open — message dropped.');
      return false;
    }
    this.ws.send(JSON.stringify(data));
    return true;
  }

  /**
   * Разрыв соединения и полная остановка (logout / смена сервера).
   */
  destroy() {
    this._destroyed = true;
    this._clearTimers();
    if (this.ws) {
      try { this.ws.close(1000, 'User logout'); } catch (_) {}
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Переподключиться заново (например, после смены сервера).
   */
  reconnect(url, token) {
    this._destroyed = false;
    this.reconnectAttempts = 0;
    this.connect(url, token);
  }

  /**
   * Получить информацию о текущем соединении.
   * @returns {{ url, model, latencyMs, lastConnectedAt, isConnected, reconnectAttempts }}
   */
  getConnectionInfo() {
    return {
      url: this.url,
      model: this.serverModel,
      serverName: this.serverName,
      latencyMs: this.latencyMs,
      lastConnectedAt: this.lastConnectedAt,
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  on(event, callback) {
    if (this.handlers[event]) {
      this.handlers[event].push(callback);
    }
  }

  off(event, callback) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter(cb => cb !== callback);
    }
  }

  emit(event, data) {
    (this.handlers[event] || []).forEach(cb => {
      try { cb(data); } catch (e) { console.error(`[WS] Error in '${event}' handler:`, e); }
    });
  }
}

window.SlugaWebSocketClient = SlugaWebSocketClient;
