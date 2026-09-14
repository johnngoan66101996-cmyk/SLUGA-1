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
    # --- Линейка Anthropic Claude (Рекомендуется для кода и архитектуры) ---
    "claude-sonnet-4.6": {
        "name": "Claude Sonnet 4.6 (По умолчанию)",
        "provider": "Anthropic / LiteAI",
        "consumption": "Сбалансированный (~3.0$ / 1M токенов)",
        "tier": "balanced",
        "description": "Идеально для глубокого анализа кода, рефакторинга, архитектуры и баг-фикса.",
        "context_window": 200000
    },
    "claude-opus-4.8": {
        "name": "Claude Opus 4.8",
        "provider": "Anthropic / LiteAI",
        "consumption": "Высокий (~15.0$ / 1M токенов)",
        "tier": "heavy",
        "description": "Максимальная логическая глубина, сложнейшие алгоритмы и математика.",
        "context_window": 200000
    },
    "claude-haiku-4.5": {
        "name": "Claude Haiku 4.5",
        "provider": "Anthropic / LiteAI",
        "consumption": "Низкий (~0.8$ / 1M токенов)",
        "tier": "economy",
        "description": "Сверхбыстрая экономная модель для типовых задач и быстрых ответов.",
        "context_window": 200000
    },

    # --- Линейка OpenAI GPT-5.x / GPT-4o ---
    "gpt-5.6-sol": {
        "name": "GPT-5.6 Sol",
        "provider": "OpenAI / LiteAI",
        "consumption": "Средний (~2.5$ / 1M токенов)",
        "tier": "balanced",
        "description": "Высокая скорость, точность и универсальность.",
        "context_window": 128000
    },
    "gpt-5.6-luna": {
        "name": "GPT-5.6 Luna",
        "provider": "OpenAI / LiteAI",
        "consumption": "Повышенный (~5.0$ / 1M токенов)",
        "tier": "heavy",
        "description": "Флагманский общий интеллект с глубоким пониманием нюансов.",
        "context_window": 128000
    },
    "openai/gpt-4o": {
        "name": "GPT-4o",
        "provider": "OpenAI / LiteAI",
        "consumption": "Средний (~2.5$ / 1M токенов)",
        "tier": "balanced",
        "description": "Мультимодальный флагман для комплексных задач.",
        "context_window": 128000
    },

    # --- Открытые и ультра-экономные модели (Минимальный расход токенов) ---
    "deepseek/deepseek-chat": {
        "name": "DeepSeek V3 / V4 Flash (Минимальный расход)",
        "provider": "DeepSeek / LiteAI",
        "consumption": "Минимальный (~0.14$ / 1M токенов — в 20 раз дешевле Sonnet!)",
        "tier": "ultra_economy",
        "description": "Рекордная экономия баланса при отличном качестве логики и русского языка.",
        "context_window": 64000
    },
    "qwen/qwen-2.5-coder-32b-instruct": {
        "name": "Qwen 2.5 Coder 32B",
        "provider": "Alibaba / LiteAI",
        "consumption": "Очень низкий (~0.20$ / 1M токенов)",
        "tier": "ultra_economy",
        "description": "Специализированная нейросеть для написания и аудита чистого кода.",
        "context_window": 128000
    },
    "glm-5.3-flash": {
        "name": "GLM-5.3 Flash",
        "provider": "Zhipu / LiteAI",
        "consumption": "Ультра-низкий (~0.10$ / 1M токенов)",
        "tier": "ultra_economy",
        "description": "Легковесная и мгновенная модель для коротких запросов.",
        "context_window": 32000
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
        if clean_model in LITEAI_MODELS_CATALOG or "/" in clean_model:
            self.liteai_model = clean_model
            self._persist_env_var("LITEAI_MODEL", clean_model)
            meta = LITEAI_MODELS_CATALOG.get(clean_model, {})
            tier_info = meta.get("consumption", "Стандартный расход")
            return f"Модель переключена на: {clean_model} ({tier_info})"
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
        liteai_model: str = Field(default="claude-sonnet-4.6", alias="LITEAI_MODEL")

        # 3. Сетевые параметры сервера
        server_host: str = Field(default="0.0.0.0", alias="SERVER_HOST")
        server_port: int = Field(default=8080, alias="SERVER_PORT")

        # 4. База данных и память SQLite WAL
        sqlite_db_path: str = Field(default="./data/sluga_memory.db", alias="SQLITE_DB_PATH")
        tts_voice: str = Field(default="ru-RU-DmitryNeural", alias="TTS_VOICE")
        log_level: str = Field(default="INFO", alias="LOG_LEVEL")
        max_react_steps: int = Field(default=12, alias="MAX_REACT_STEPS")

except ImportError:
    class Settings(ConfigMethodsMixin):
        def __init__(self):
            self.sluga_bot_token = os.getenv("SLUGA_BOT_TOKEN", "sluga-core-token")
            self.liteai_api_key = os.getenv("LITEAI_API_KEY", None)
            self.liteai_base_url = os.getenv("LITEAI_BASE_URL", "https://api.liteai.tech/v1")
            self.liteai_model = os.getenv("LITEAI_MODEL", "claude-sonnet-4.6")
            self.server_host = os.getenv("SERVER_HOST", "0.0.0.0")
            self.server_port = int(os.getenv("SERVER_PORT", "8080"))
            self.sqlite_db_path = os.getenv("SQLITE_DB_PATH", "./data/sluga_memory.db")
            self.tts_voice = os.getenv("TTS_VOICE", "ru-RU-DmitryNeural")
            self.log_level = os.getenv("LOG_LEVEL", "INFO")
            self.max_react_steps = int(os.getenv("MAX_REACT_STEPS", "12"))


settings = Settings()
