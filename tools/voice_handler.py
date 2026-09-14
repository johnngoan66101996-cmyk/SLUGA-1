"""
Модуль голосового взаимодействия агента SLUGA (STT + TTS).
1. STT (Speech-to-Text): Распознавание голосовых сообщений (.ogg/.opus/mp4/любой формат)
   - Основной канал: Google Speech Recognition через SpeechRecognition + ffmpeg (бесплатно, без API ключей, высокая точность на русском).
   - Кэширование: Хэширование аудио (MD5) для мгновенного ответа без повторной обработки.
2. TTS (Text-to-Speech): Высококачественный синтез реалистичной русской речи через Microsoft Edge-TTS (без API ключей, бесплатно).
"""

import re
import io
import json
import hashlib
import logging
import asyncio
import subprocess
from pathlib import Path
from typing import Optional

from config import settings, BASE_DIR

logger = logging.getLogger("SLUGA_VOICE")

# Качественный русский мужской голос по умолчанию
DEFAULT_VOICE = "ru-RU-DmitryNeural"

# Кэш распознанных аудиосообщений (MD5 -> текст)
CACHE_DIR = BASE_DIR / "data" / "cache"
STT_CACHE_FILE = CACHE_DIR / "stt_cache.json"


def _get_from_cache(audio_hash: str) -> Optional[str]:
    try:
        if STT_CACHE_FILE.exists():
            with open(STT_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get(audio_hash)
    except Exception as e:
        logger.debug(f"Ошибка чтения кэша STT: {e}")
    return None


def _save_to_cache(audio_hash: str, text: str):
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        data = {}
        if STT_CACHE_FILE.exists():
            with open(STT_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        data[audio_hash] = text
        if len(data) > 500:
            keys = list(data.keys())
            for k in keys[:-400]:
                del data[k]
        with open(STT_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.debug(f"Ошибка записи кэша STT: {e}")


def prepare_text_for_speech(text: str, max_chars: int = 500) -> str:
    """Очищает текст от блоков кода Markdown и ссылок для комфортного восприятия на слух."""
    cleaned = re.sub(r'```[\s\S]*?```', '', text)
    cleaned = re.sub(r'`([^`]+)`', r'\1', cleaned)
    cleaned = re.sub(r'[#*_~>]+', '', cleaned)
    cleaned = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', cleaned)
    cleaned = re.sub(r'[🤖🛠️🧠🩺✅❌⚠️💡📁🚀]', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    if not cleaned:
        return "Задача выполнена. Подробный отчет и код отправлены в сообщении выше."

    if len(cleaned) > max_chars:
        truncated = cleaned[:max_chars]
        last_dot = max(truncated.rfind('.'), truncated.rfind('!'), truncated.rfind('?'))
        if last_dot > 100:
            cleaned = truncated[:last_dot + 1]
        else:
            cleaned = truncated
        cleaned += " Полный отчет и детали в сообщении выше."

    return cleaned


def _transcode_to_wav_sync(audio_bytes: bytes) -> bytes:
    """Транскодирует любой аудио-поток в 16kHz mono WAV через FFmpeg."""
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-i", "pipe:0", "-f", "wav", "-ar", "16000", "-ac", "1", "pipe:1"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    wav_data, err = proc.communicate(input=audio_bytes)
    if proc.returncode != 0 or not wav_data:
        raise RuntimeError(f"FFmpeg ошибка транскодирования: {err.decode('utf-8', errors='ignore')}")
    return wav_data


async def _recognize_via_speech_recognition(audio_bytes: bytes) -> str:
    """Распознавание речи через SpeechRecognition (Google Free Engine)."""
    import speech_recognition as sr

    def _sync_recognize():
        wav_bytes = _transcode_to_wav_sync(audio_bytes)
        r = sr.Recognizer()
        with sr.AudioFile(io.BytesIO(wav_bytes)) as source:
            audio_data = r.record(source)
        return r.recognize_google(audio_data, language="ru-RU")

    return await asyncio.to_thread(_sync_recognize)


async def transcribe_voice(audio_bytes: bytes, mime_type: str = "audio/ogg") -> str:
    """Распознает речь из переданных аудио-байтов в текст."""
    if not audio_bytes or len(audio_bytes) < 100:
        raise ValueError("Голосовой файл пустой или повреждён (размер < 100 байт).")

    audio_hash = hashlib.md5(audio_bytes).hexdigest()
    cached = _get_from_cache(audio_hash)
    if cached:
        logger.info(f"Речь получена из STT-кэша: '{cached[:40]}...'")
        return cached

    try:
        logger.info("Распознавание речи через SpeechRecognition...")
        recognized = await _recognize_via_speech_recognition(audio_bytes)
        recognized = recognized.strip()
        if recognized:
            logger.info(f"Речь успешно расшифрована: '{recognized[:50]}...'")
            _save_to_cache(audio_hash, recognized)
            return recognized
    except Exception as e:
        logger.warning(f"SpeechRecognition завершился с предупреждением: {e}")

    raise RuntimeError("Не удалось распознать голосовое сообщение. Попробуйте повторить запись чётче.")


async def synthesize_voice(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """Преобразует текст ответа агента в аудио-файл (.mp3) через Microsoft Edge-TTS."""
    import edge_tts

    spoken_text = prepare_text_for_speech(text)
    logger.info(f"Синтез речи (Edge-TTS, голос {voice}): '{spoken_text[:60]}...'")

    communicate = edge_tts.Communicate(spoken_text, voice=voice)
    audio_buffer = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_buffer.write(chunk["data"])

    audio_bytes = audio_buffer.getvalue()
    if not audio_bytes:
        raise RuntimeError("Не удалось сгенерировать аудиопоток Edge-TTS.")

    return audio_bytes
