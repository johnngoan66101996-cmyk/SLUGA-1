/**
 * Voice Audio Recorder & Player for SLUGA Messenger (Web & Android Mobile)
 * Поддерживает аппаратную запись аудио через MediaRecorder и гибридный Web Speech API
 */
class SlugaVoiceManager {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.stream = null;
    this.timerInterval = null;
    this.recordStartTime = 0;
    this.speechRecognizer = null;
    this.liveTranscript = '';
  }

  /**
   * Запрос доступа к микрофону и старт записи
   */
  async startRecording(onTick = null, onLiveText = null) {
    if (this.isRecording) return true;
    this.audioChunks = [];
    this.liveTranscript = '';

    try {
      // 1. Проверяем поддержку mediaDevices
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Устройство не предоставляет доступ к микрофону через Web API.');
      }

      // 2. Запрос микрофона с мягкими fallback-параметрами (для Android гарнитур и PC)
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
      } catch (e1) {
        console.warn('[Voice] Echo cancellation audio failed, fallback to basic audio', e1);
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      // 3. Выбор лучшего поддерживаемого MIME-типа (WebM Opus для Chrome/Android, MP4 для Safari/iOS)
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/aac',
        ''
      ];
      let selectedMime = '';
      for (const t of mimeTypes) {
        if (!t || (window.MediaRecorder && MediaRecorder.isTypeSupported(t))) {
          selectedMime = t;
          break;
        }
      }

      const options = selectedMime ? { mimeType: selectedMime } : {};
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onerror = (e) => {
        console.error('[Voice] MediaRecorder error:', e);
      };

      // Запуск с частым сбросом буфера (200ms)
      this.mediaRecorder.start(200);
      this.isRecording = true;

      // 4. Опциональный параллельный Web Speech API для мгновенной транскрипции на экране
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          this.speechRecognizer = new SpeechRecognition();
          this.speechRecognizer.lang = 'ru-RU';
          this.speechRecognizer.continuous = true;
          this.speechRecognizer.interimResults = true;

          this.speechRecognizer.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              interim += event.results[i][0].transcript;
            }
            this.liveTranscript = interim;
            if (onLiveText) onLiveText(interim);
          };

          this.speechRecognizer.onerror = (err) => {
            console.warn('[Voice] SpeechRecognition non-fatal error:', err);
          };

          this.speechRecognizer.start();
        } catch (e) {
          console.warn('[Voice] SpeechRecognition could not start concurrently:', e);
        }
      }

      // 5. Таймер записи
      this.recordStartTime = Date.now();
      if (onTick) {
        onTick(0);
        this.timerInterval = setInterval(() => {
          const seconds = Math.floor((Date.now() - this.recordStartTime) / 1000);
          onTick(seconds);
        }, 300);
      }

      return true;
    } catch (err) {
      console.error('[Voice] Microphone access error:', err);
      let errMsg = 'Не удалось получить доступ к микрофону.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errMsg = 'Доступ к микрофону заблокирован. Разрешите микрофон в настройках браузера/приложения для голосового ввода.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errMsg = 'Микрофон не обнаружен в системе. Подключите микрофон или гарнитуру.';
      }
      alert(errMsg);
      return false;
    }
  }

  /**
   * Остановка записи и формирование готового Base64 аудиопакета
   */
  stopRecording() {
    return new Promise((resolve) => {
      if (!this.isRecording || !this.mediaRecorder) {
        this._cleanup();
        resolve(null);
        return;
      }

      if (this.speechRecognizer) {
        try { this.speechRecognizer.stop(); } catch (e) {}
        this.speechRecognizer = null;
      }

      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }

      const durationSec = Math.max(1, Math.round((Date.now() - this.recordStartTime) / 1000));

      this.mediaRecorder.onstop = () => {
        try {
          const mime = this.mediaRecorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(this.audioChunks, { type: mime });
          
          this._releaseStream();
          this.isRecording = false;

          if (audioBlob.size === 0) {
            console.warn('[Voice] AudioBlob is empty');
            resolve(null);
            return;
          }

          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = () => {
            const resultStr = reader.result || '';
            const base64Data = resultStr.includes(',') ? resultStr.split(',')[1] : '';
            resolve({
              base64: base64Data,
              blob: audioBlob,
              mimeType: audioBlob.type || 'audio/webm',
              duration: durationSec,
              liveTranscript: this.liveTranscript
            });
          };
        } catch (e) {
          console.error('[Voice] Error processing audio blob:', e);
          this._cleanup();
          resolve(null);
        }
      };

      try {
        if (this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.requestData();
        }
        this.mediaRecorder.stop();
      } catch (err) {
        console.warn('[Voice] Error stopping mediaRecorder:', err);
        this._cleanup();
        resolve(null);
      }
    });
  }

  /**
   * Отмена записи без отправки
   */
  cancelRecording() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.speechRecognizer) {
      try { this.speechRecognizer.stop(); } catch (e) {}
      this.speechRecognizer = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch (e) {}
    }
    this._releaseStream();
    this.isRecording = false;
    this.audioChunks = [];
  }

  _releaseStream() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  _cleanup() {
    this._releaseStream();
    this.isRecording = false;
    this.audioChunks = [];
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Воспроизведение аудио Base64 (TTS ответ)
   */
  playBase64Audio(base64Str, mimeType = 'audio/wav') {
    return new Promise((resolve, reject) => {
      try {
        const audioSrc = `data:${mimeType};base64,${base64Str}`;
        const audio = new Audio(audioSrc);
        audio.onended = () => resolve();
        audio.onerror = (e) => reject(e);
        audio.play().catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  }
}

window.SlugaVoiceManager = SlugaVoiceManager;
