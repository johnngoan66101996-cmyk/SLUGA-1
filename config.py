"""
Модуль конфигурации серверного агента SLUGA.
100% независим, безопасен и адаптирован для работы в РФ без VPN через официальный шлюз LiteAI (https://liteai.tech).
"""

import os
import secrets
from pathlib import Path
from typing import Dict, Any, Optional, List

BASE_DIR = Path(__file__).resolve().parent

# ==============================================================================
# ОФИЦИАЛЬНЫЙ КАТАЛОГ МОДЕЛЕЙ LITEAI (https://liteai.tech/docs)
# Таблица расхода токенов и специализаций
# ==============================================================================
LITEAI_MODELS_CATALOG: Dict[str, Dict[str, Any]] = {
    # --- Anthropic Claude ---
    "claude-sonnet-4-6": {
        "name": "Claude Sonnet 4.6 (По умолчанию)",
        "provider": "Anthropic / LiteAI",
        "consumption": "Баланс скорости и качества",
        "tier": "balanced",
        "description": "Баланс скорости и качества, идеален для кода и архитектуры.",
        "context_window": 200000
    },
    "claude-sonnet-5": {
        "name": "Claude Sonnet 5",
        "provider": "Anthropic / LiteAI",
        "consumption": "Следующее поколение",
        "tier": "balanced",
        "description": "Следующее поколение: баланс скорости и качества.",
        "context_window": 200000
    },
    "claude-opus-5": {
        "name": "Claude Opus 5",
        "provider": "Anthropic / LiteAI",
        "consumption": "Высокий",
        "tier": "heavy",
        "description": "Флагман нового поколения для самых сложных задач.",
        "context_window": 200000
    },
    "claude-opus-4-8": {
        "name": "Claude Opus 4.8 (200K)",
        "provider": "Anthropic / LiteAI",
        "consumption": "Высокий",
        "tier": "heavy",
        "description": "Самая мощная, сложные задачи.",
        "context_window": 200000
    },
    "claude-opus-4-8[1m]": {
        "name": "Claude Opus 4.8 (1.0M контекст)",
        "provider": "Anthropic / LiteAI",
        "consumption": "Максимальный",
        "tier": "heavy",
        "description": "Самая мощная, огромный контекст 1.0M токенов.",
        "context_window": 1000000
    },
    "claude-haiku-4-5": {
        "name": "Claude Haiku 4.5",
        "provider": "Anthropic / LiteAI",
        "consumption": "Низкий",
        "tier": "economy",
        "description": "Быстрые инференс-задачи.",
        "context_window": 200000
    },

    # --- OpenAI GPT-5.x ---
    "gpt-5.6-luna": {
        "name": "GPT-5.6 Luna",
        "provider": "OpenAI / LiteAI",
        "consumption": "Длинный контекст (1.1M)",
        "tier": "heavy",
        "description": "Длинный контекст и творческие задачи.",
        "context_window": 1100000
    },
    "gpt-5.6-sol": {
        "name": "GPT-5.6 Sol",
        "provider": "OpenAI / LiteAI",
        "consumption": "Строгий формат (1.1M)",
        "tier": "balanced",
        "description": "Строгий формат и точные инструкции.",
        "context_window": 1100000
    },
    "gpt-5.6-terra": {
        "name": "GPT-5.6 Terra",
        "provider": "OpenAI / LiteAI",
        "consumption": "Рассуждения (1.1M)",
        "tier": "heavy",
        "description": "Многошаговые рассуждения и пайплайны.",
        "context_window": 1100000
    },

    # --- Другие открытые модели ---
    "deepseek/deepseek-v4-flash-0731": {
        "name": "DeepSeek V4 Flash 0731",
        "provider": "DeepSeek / LiteAI",
        "consumption": "Ультра-эконом (1.3M)",
        "tier": "ultra_economy",
        "description": "Быстрая открытая модель для ежедневных задач с контекстом 1.3M.",
        "context_window": 1300000
    },
    "qwen/qwen3.7-flash": {
        "name": "Qwen 3.7 Flash",
        "provider": "Alibaba / LiteAI",
        "consumption": "Эконом (1.0M)",
        "tier": "ultra_economy",
        "description": "Alibaba Qwen 3.7, сильная мультиязычная открытая модель.",
        "context_window": 1000000
    },
    "z-ai/glm-5.3-flash": {
        "name": "GLM 5.3 Flash",
        "provider": "Zhipu / LiteAI",
        "consumption": "Ультра-эконом (1.3M)",
        "tier": "ultra_economy",
        "description": "Zhipu GLM-5.3 Flash, быстрая открытая модель.",
        "context_window": 1300000
    },
    "nvidia/nemotron-3.5-lightning": {
        "name": "Nemotron 3.5 Lightning",
        "provider": "NVIDIA / LiteAI",
        "consumption": "Эконом (262K)",
        "tier": "economy",
        "description": "NVIDIA Nemotron, быстрая открытая модель.",
        "context_window": 262000
    },
    "xiaomi/mimo-v2.5": {
        "name": "MiMo v2.5",
        "provider": "Xiaomi / LiteAI",
        "consumption": "Эконом (1.1M)",
        "tier": "economy",
        "description": "Xiaomi MiMo v2.5, эффективная открытая модель.",
        "context_window": 1100000
    },
    "ibm-granite/granite-4.2-8b": {
        "name": "Granite 4.2 8B",
        "provider": "IBM / LiteAI",
        "consumption": "Ультра-эконом (131K)",
        "tier": "ultra_economy",
        "description": "IBM Granite 4.2, свежий открытый релиз.",
        "context_window": 131000
    }
}


class ConfigMethodsMixin:
    """Методы управления конфигурацией на лету и персистенции в .env."""

    def update_key_runtime(self, provider: str, new_key: str) -> str:
        clean_key = new_key.strip().strip("<>").strip()
        self.liteai_api_key = clean_key
        self._persist_env_var("LITEAI_API_KEY", clean_key)
        return "LiteAI API ключ успешно сохранен."

    def update_model_runtime(self, new_model: str) -> str:
        clean_model = new_model.strip().strip("<>").strip()
        # Нормализуем имя модели: claude-sonnet-4.6 → claude-sonnet-4-6 (для совместимости .env)
        normalized = clean_model.replace(".", "-")
        if normalized in LITEAI_MODELS_CATALOG or "/" in clean_model:
            self.liteai_model = normalized
            self._persist_env_var("LITEAI_MODEL", normalized)
            meta = LITEAI_MODELS_CATALOG.get(normalized, {})
            tier_info = meta.get("consumption", "Стандартный расход")
            return f"Модель переключена на: {normalized} ({tier_info})"
        # Неизвестная модель — сохраняем как есть
        self.liteai_model = clean_model
        self._persist_env_var("LITEAI_MODEL", clean_model)
        return f"Модель {clean_model} сохранена в конфигурации."

    def set_bot_token(self, new_token: str) -> str:
        clean_token = new_token.strip()
        self.sluga_bot_token = clean_token
        self._persist_env_var("SLUGA_BOT_TOKEN", clean_token)
        return clean_token

    def _persist_env_var(self, key_name: str, key_value: str):
        env_path = BASE_DIR / ".env"
        lines = []
        key_found = False
        if env_path.exists():
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith(f"{key_name}="):
                        lines.append(f"{key_name}={key_value}\n")
                        key_found = True
                    else:
                        lines.append(line)
        if not key_found:
            lines.append(f"{key_name}={key_value}\n")

        with open(env_path, "w", encoding="utf-8") as f:
            f.writelines(lines)


try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
    from pydantic import Field

    class Settings(BaseSettings, ConfigMethodsMixin):
        model_config = SettingsConfigDict(
            env_file=str(BASE_DIR / ".env"),
            env_file_encoding="utf-8",
            extra="ignore"
        )

        # 1. Токен связи с ботом (Ключ сопряжения клиента и сервера)
        sluga_bot_token: str = Field(default="sluga-core-token", alias="SLUGA_BOT_TOKEN")

        # 2. Шлюз LiteAI (Официальный шлюз нейросетей в РФ)
        liteai_api_key: Optional[str] = Field(default=None, alias="LITEAI_API_KEY")
        liteai_base_url: str = Field(default="https://api.liteai.tech/v1", alias="LITEAI_BASE_URL")
        liteai_model: str = Field(default="claude-sonnet-4-6", alias="LITEAI_MODEL")

        # 3. Публичный домен (ОБЯЗАТЕЛЬНО заполнить в .env)
        # Пример: SLUGA_DOMAIN=sugatov-it.ru
        # Сервер изнутри слушает 127.0.0.1:8080, снаружи работает ТОЛЬКО через домен.
        sluga_domain: Optional[str] = Field(default=None, alias="SLUGA_DOMAIN")

        # 3a. Внутренний сетевой сокет (только для uvicorn, НЕ для клиента)
        server_host: str = Field(default="127.0.0.1", alias="SERVER_HOST")
        server_port: int = Field(default=8080, alias="SERVER_PORT")

        # 4. База данных и память SQLite WAL
        sqlite_db_path: str = Field(default="./data/sluga_memory.db", alias="SQLITE_DB_PATH")
        tts_voice: str = Field(default="ru-RU-DmitryNeural", alias="TTS_VOICE")
        log_level: str = Field(default="INFO", alias="LOG_LEVEL")
        max_react_steps: int = Field(default=12, alias="MAX_REACT_STEPS")

        @property
        def public_ws_url(self) -> str:
            """Публичный WebSocket URL — всегда через домен."""
            if self.sluga_domain:
                return f"wss://{self.sluga_domain}/ws"
            return f"ws://127.0.0.1:{self.server_port}/ws"

        @property
        def public_http_url(self) -> str:
            """Публичный HTTP URL — всегда через домен."""
            if self.sluga_domain:
                return f"https://{self.sluga_domain}"
            return f"http://127.0.0.1:{self.server_port}"

except ImportError:
    class Settings(ConfigMethodsMixin):
        def __init__(self):
            self.sluga_bot_token = os.getenv("SLUGA_BOT_TOKEN", "sluga-core-token")
            self.liteai_api_key = os.getenv("LITEAI_API_KEY", None)
            self.liteai_base_url = os.getenv("LITEAI_BASE_URL", "https://api.liteai.tech/v1")
            self.liteai_model = os.getenv("LITEAI_MODEL", "claude-sonnet-4-6").replace(".", "-")
            self.sluga_domain = os.getenv("SLUGA_DOMAIN", None)
            self.server_host = os.getenv("SERVER_HOST", "127.0.0.1")
            self.server_port = int(os.getenv("SERVER_PORT", "8080"))
            self.sqlite_db_path = os.getenv("SQLITE_DB_PATH", "./data/sluga_memory.db")
            self.tts_voice = os.getenv("TTS_VOICE", "ru-RU-DmitryNeural")
            self.log_level = os.getenv("LOG_LEVEL", "INFO")
            self.max_react_steps = int(os.getenv("MAX_REACT_STEPS", "12"))

        @property
        def public_ws_url(self) -> str:
            if self.sluga_domain:
                return f"wss://{self.sluga_domain}/ws"
            return f"ws://127.0.0.1:{self.server_port}/ws"

        @property
        def public_http_url(self) -> str:
            if self.sluga_domain:
                return f"https://{self.sluga_domain}"
            return f"http://127.0.0.1:{self.server_port}"


settings = Settings()
