/**
 * Voice Audio Recorder & Player for SlugaGram (Web, PC Desktop & Android Mobile)
 * Поддерживает аппаратную запись аудио через MediaRecorder, визуализацию и воспроизведение
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
    this.currentAudio = null;
  }

  async startRecording(onTick = null, onLiveText = null) {
    if (this.isRecording) return true;
    this.audioChunks = [];
    this.liveTranscript = '';

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Доступ к микрофону не поддерживается данным браузером.');
      }

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
      } catch (e) {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

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

      this.mediaRecorder.start(200);
      this.isRecording = true;

      // Web Speech API для мгновенной транскрипции
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

          this.speechRecognizer.onerror = () => {};
          this.speechRecognizer.start();
        } catch (e) {}
      }

      this.recordStartTime = Date.now();
      this.timerInterval = setInterval(() => {
        const elapsedSecs = Math.floor((Date.now() - this.recordStartTime) / 1000);
        if (onTick) onTick(elapsedSecs);
      }, 1000);

      return true;
    } catch (err) {
      console.error('[Voice] Error starting recording:', err);
      alert('Ошибка доступа к микрофону: ' + (err.message || 'Разрешите доступ к микрофону в настройках браузера.'));
      this.cleanup();
      return false;
    }
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.isRecording || !this.mediaRecorder) {
        this.cleanup();
        resolve(null);
        return;
      }

      const durationSecs = Math.max(1, Math.floor((Date.now() - this.recordStartTime) / 1000));

      this.mediaRecorder.onstop = async () => {
        const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });

        const base64 = await this.blobToBase64(audioBlob);
        const transcript = this.liveTranscript.trim();

        this.cleanup();

        resolve({
          blob: audioBlob,
          base64: base64,
          mimeType: mimeType,
          duration: durationSecs,
          liveTranscript: transcript
        });
      };

      try {
        this.mediaRecorder.stop();
      } catch (e) {
        this.cleanup();
        resolve(null);
      }
    });
  }

  cancelRecording() {
    this.cleanup();
  }

  cleanup() {
    this.isRecording = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.speechRecognizer) {
      try { this.speechRecognizer.stop(); } catch (e) {}
      this.speechRecognizer = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        const base64String = result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  playAudioBase64(base64Data, mimeType = 'audio/mp3') {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch (e) {}
    }
    try {
      this.currentAudio = new Audio(`data:${mimeType};base64,${base64Data}`);
      return this.currentAudio.play();
    } catch (e) {
      console.warn('[Voice] Audio playback failed:', e);
      return Promise.reject(e);
    }
  }
}

window.SlugaVoiceManager = SlugaVoiceManager;
