"""
Мост между сервером WebSocket и ядром интеллекта SLUGA.
Управляет сессиями, контекстом, файлами скрепки, голосовыми сообщениями и памятью SQLite.
"""

import os
import sys
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from config import settings
from core.engine import SlugaEngine
from tools.voice_handler import transcribe_voice, synthesize_voice

logger = logging.getLogger("SLUGA_BRIDGE")

class AIBridge:
    def __init__(self):
        self.engine = SlugaEngine()
        self.memory = self.engine.memory
        self.uploads_dir = BASE_DIR / "data" / "uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)

    def get_chats_list(self) -> List[Dict[str, Any]]:
        """Возвращает список веток чата для мессенджера."""
        return [
            {
                "id": "sluga_core",
                "title": "🤖 SLUGA AI (Инженер-Хирург)",
                "avatar": "🤖",
                "last_message": "Готов к работе. Ожидаю задачу.",
                "unread": 0,
                "online": True
            }
        ]

    def get_chat_history(self, session_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Загружает историю сообщений из SQLite памяти."""
        history = self.memory.get_history(session_id, limit=limit)
        messages = []
        for idx, row in enumerate(history):
            messages.append({
                "id": idx + 1,
                "role": row["role"],
                "content": row["content"],
                "created_at": "",
                "tool_calls": row.get("tool_calls")
            })
        return messages

    async def process_message(
        self,
        session_id: str,
        text: str,
        files: Optional[List[Dict[str, Any]]] = None,
        progress_callback = None
    ) -> Dict[str, Any]:
        """Обработка текстового сообщения с поддержкой прикрепленных файлов со скрепки 📎."""
        prompt = text.strip()
        attached_info = []

        if files:
            for f in files:
                fname = f.get("name", "file")
                fpath = f.get("path")
                ftype = f.get("type", "")
                fsize = f.get("size", 0)

                # Если файл текстовый или кодовый — добавляем его содержимое в контекст
                if ftype.startswith("text/") or any(fname.endswith(ext) for ext in [".py", ".js", ".html", ".css", ".json", ".md", ".txt", ".sql", ".sh", ".bat"]):
                    try:
                        p = Path(fpath)
                        if p.exists():
                            content = p.read_text(encoding="utf-8", errors="ignore")
                            attached_info.append(f"\n📎 [Прикреплен файл {fname}]:\n```\n{content[:5000]}\n```")
                    except Exception as e:
                        attached_info.append(f"\n📎 [Файл {fname}, {fsize} байт (ошибка чтения: {e})]")
                else:
                    attached_info.append(f"\n📎 [Прикреплен медиа-файл / изображение: {fname}, путь: {fpath}]")

        if attached_info:
            prompt += "\n" + "\n".join(attached_info)

        # Запуск ReAct цикла агента
        response = await self.engine.process_user_request(
            session_id=session_id,
            user_prompt=prompt,
            status_callback=progress_callback
        )

        return {
            "session_id": session_id,
            "role": "assistant",
            "content": response,
            "created_at": ""
        }

    async def process_voice(self, audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
        """Распознает голосовое аудио из приложения в текст."""
        return await transcribe_voice(audio_bytes, mime_type=mime_type)

    async def synthesize_speech(self, text: str) -> bytes:
        """Синтезирует речь для голосового ответа."""
        return await synthesize_voice(text)

    def save_uploaded_file(self, filename: str, content_bytes: bytes) -> Dict[str, Any]:
        """Сохраняет файл из скрепки 📎 на сервере."""
        safe_name = Path(filename).name
        target_path = self.uploads_dir / safe_name
        target_path.write_bytes(content_bytes)
        return {
            "name": safe_name,
            "path": str(target_path),
            "size": len(content_bytes),
            "url": f"/uploads/{safe_name}"
        }

    def update_api_key(self, key: str) -> str:
        return settings.update_key_runtime("liteai", key)

    def update_model(self, model_name: str) -> str:
        return settings.update_model_runtime(model_name)
