"""
Высокоскоростной асинхронный сервер SLUGA на FastAPI и WebSockets.
Оснащен системой защиты Bot Token: соединение устанавливается ТОЛЬКО
при совпадении токена связи бота, выданного при установке сервера.
"""

import os
import sys
import json
import base64
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException, Query, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from config import settings, LITEAI_MODELS_CATALOG
from core.auth import verify_bot_token
from server.ai_bridge import AIBridge

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("SLUGA_SERVER")

app = FastAPI(title="SLUGA AI Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bridge = AIBridge()
UPLOADS_DIR = BASE_DIR / "data" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_json(self, websocket: WebSocket, data: dict):
        await websocket.send_json(data)


manager = ConnectionManager()


@app.get("/")
async def root_status():
    """Публичный статус-пинг сервера."""
    return JSONResponse({
        "status": "online",
        "service": "SLUGA AI Server",
        "auth_required": True,
        "hint": "Подключение клиентов осуществляется через WebSocket /ws?token=YOUR_BOT_TOKEN"
    })


@app.get("/api/status")
async def get_status():
    """Статус сервера и активная модель LiteAI."""
    meta = LITEAI_MODELS_CATALOG.get(settings.liteai_model, {})
    return JSONResponse({
        "status": "running",
        "model": settings.liteai_model,
        "consumption": meta.get("consumption", "Стандартный"),
        "has_api_key": bool(settings.liteai_api_key),
        "gateway": settings.liteai_base_url
    })


@app.get("/api/models")
async def get_models_catalog():
    """Возвращает полный каталог достоверных моделей LiteAI и расход токенов."""
    return JSONResponse({
        "current_model": settings.liteai_model,
        "models": LITEAI_MODELS_CATALOG
    })


@app.get("/api/history/{session_id}")
async def get_history(session_id: str, token: Optional[str] = None):
    """История сообщений сессии (защищена токеном)."""
    if token and not verify_bot_token(token):
        raise HTTPException(status_code=403, detail="Неверный Bot Token")
    history = bridge.get_chat_history(session_id)
    return JSONResponse(history)


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Загрузка файлов со скрепки 📎."""
    content = await file.read()
    info = bridge.save_uploaded_file(file.filename, content)
    info["type"] = file.content_type or "application/octet-stream"
    return JSONResponse(info)


@app.post("/api/tts")
async def text_to_speech(text: str = Form(...)):
    """Синтез речи через бесплатный Microsoft Edge-TTS."""
    try:
        audio_bytes = await bridge.synthesize_speech(text)
        return Response(content=audio_bytes, media_type="audio/mp3")
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/clear_memory")
async def clear_memory(session_id: str = "sluga_core"):
    """Очищает память сессии в SQLite."""
    bridge.memory.clear_history(session_id)
    return JSONResponse({"status": "cleared", "session_id": session_id})


@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(None)
):
    """
    Защищенный WebSocket-канал связи.
    При подключении ОБЯЗАТЕЛЬНО проверяется Токен связи с ботом.
    При неверном токене соединение отклоняется с кодом 4003 (Forbidden).
    """
    # 1. Проверка авторизации по Bot Token
    if not verify_bot_token(token or ""):
        logger.warning(f"[WS Auth] Отклонено неавторизованное подключение (неверный токен: '{token}')")
        await websocket.close(code=4003, reason="Forbidden: Invalid Bot Token")
        return

    # 2. Авторизация успешна
    await manager.connect(websocket)
    logger.info("[WS Auth] Успешное защищенное подключение клиента по Bot Token.")

    # Отправляем подтверждение авторизации
    await manager.send_json(websocket, {
        "event": "authenticated",
        "status": "online",
        "bot_name": "SLUGA",
        "model": settings.liteai_model
    })

    current_session = "sluga_core"

    try:
        while True:
            raw_data = await websocket.receive_text()
            data = json.loads(raw_data)
            action = data.get("action") or data.get("type")

            # Обновление динамических настроек сессии
            if data.get("api_key"):
                bridge.update_api_key(data.get("api_key"))
            if data.get("model"):
                bridge.update_model(data.get("model"))

            if action in ("join_session", "join"):
                current_session = data.get("session_id", "sluga_core")
                history = bridge.get_chat_history(current_session)
                await manager.send_json(websocket, {
                    "event": "history_loaded",
                    "session_id": current_session,
                    "history": history
                })

            elif action in ("send_message", "message"):
                session_id = data.get("session_id", current_session)
                text = data.get("text", "")
                files = data.get("files") or data.get("attachments") or []

                async def notify_progress(status_text: str):
                    await manager.send_json(websocket, {
                        "event": "progress",
                        "session_id": session_id,
                        "text": status_text
                    })

                try:
                    result = await bridge.process_message(
                        session_id=session_id,
                        text=text,
                        files=files,
                        progress_callback=notify_progress
                    )
                    await manager.send_json(websocket, {
                        "event": "message_response",
                        "session_id": session_id,
                        "message": result
                    })
                except Exception as err:
                    logger.exception("Ошибка обработки сообщения агентом")
                    await manager.send_json(websocket, {
                        "event": "error",
                        "session_id": session_id,
                        "error": str(err)
                    })

            elif action in ("send_voice", "voice"):
                session_id = data.get("session_id", current_session)
                b64_audio = data.get("audio_base64", "")
                mime_type = data.get("mime_type", "audio/webm")

                await manager.send_json(websocket, {
                    "event": "progress",
                    "session_id": session_id,
                    "text": "🎙️ Распознаю речь (STT)..."
                })

                try:
                    audio_bytes = base64.b64decode(b64_audio)
                    recognized_text = await bridge.process_voice(audio_bytes, mime_type=mime_type)

                    await manager.send_json(websocket, {
                        "event": "voice_recognized",
                        "session_id": session_id,
                        "text": recognized_text
                    })

                    async def notify_progress(status_text: str):
                        await manager.send_json(websocket, {
                            "event": "progress",
                            "session_id": session_id,
                            "text": status_text
                        })

                    result = await bridge.process_message(
                        session_id=session_id,
                        text=recognized_text,
                        progress_callback=notify_progress
                    )

                    await manager.send_json(websocket, {
                        "event": "message_response",
                        "session_id": session_id,
                        "message": result
                    })

                except Exception as err:
                    logger.exception("Ошибка обработки голосового сообщения")
                    await manager.send_json(websocket, {
                        "event": "error",
                        "session_id": session_id,
                        "error": f"Сбой распознавания речи: {err}"
                    })

            elif action == "update_key":
                new_key = data.get("key", "")
                status_msg = bridge.update_api_key(new_key)
                await manager.send_json(websocket, {
                    "event": "settings_updated",
                    "message": status_msg
                })

            elif action == "update_model":
                new_model = data.get("model", "")
                status_msg = bridge.update_model(new_model)
                await manager.send_json(websocket, {
                    "event": "settings_updated",
                    "message": status_msg
                })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WebSocket исключение: {e}")
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server.app:app",
        host=settings.server_host,
        port=settings.server_port,
        reload=False
    )
