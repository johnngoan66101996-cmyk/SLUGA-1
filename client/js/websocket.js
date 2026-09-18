/**
 * WebSocket Connection Client for SLUGA Messenger
 * Обеспечивает отказоустойчивое соединение с автопереподключением и защитой сессии
 */
class SlugaWebSocketClient {
  constructor() {
    this.ws = null;
    this.url = '';
    this.token = '';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 2000;
    this.isConnected = false;
    this.handlers = {
      message: [],
      chunk: [],
      status: [],
      error: [],
      connect: [],
      disconnect: [],
      authenticated: []
    };
  }

  connect(url, token = '') {
    this.url = url || (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';
    this.token = token;

    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
    }

    try {
      const fullUrl = this.token ? `${this.url}?token=${encodeURIComponent(this.token)}` : this.url;
      this.ws = new WebSocket(fullUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connect', { url: this.url });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleIncoming(data);
        } catch (err) {
          console.error('[WS] Failed to parse JSON message:', event.data, err);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[WS] Connection error:', err);
        this.emit('error', err);
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        this.emit('disconnect', event);
        this.scheduleReconnect();
      };
    } catch (e) {
      console.error('[WS] Initialization failed:', e);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const timeout = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 15000);
      console.log(`[WS] Reconnecting in ${timeout}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => this.connect(this.url, this.token), timeout);
    }
  }

  handleIncoming(payload) {
    // Поддерживаем оба формата: {type: ...} и {event: ...}
    const type = payload.type || payload.event || 'message';
    if (type === 'authenticated') {
      this.emit('authenticated', payload);
    } else if (type === 'chunk') {
      this.emit('chunk', payload);
    } else if (type === 'status') {
      this.emit('status', payload);
    } else if (type === 'error') {
      this.emit('error', payload);
    } else {
      this.emit('message', payload);
    }
  }

  send(data) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Socket is not open. Message queued or dropped.');
      return false;
    }
    this.ws.send(JSON.stringify(data));
    return true;
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
    if (this.handlers[event]) {
      this.handlers[event].forEach(cb => {
        try {
          cb(data);
        } catch (e) {
          console.error(`[WS] Handler error on '${event}':`, e);
        }
      });
    }
  }
}

window.SlugaWebSocketClient = SlugaWebSocketClient;
