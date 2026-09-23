"""
Модуль аутентификации и управления Токеном связи бота (Bot Token).
Обеспечивает 100% изоляцию: только авторизованный клиент (ПК или мобильный)
может связываться с агентом на сервере.
"""

import hmac
import secrets
import logging
from typing import Tuple

from config import settings

logger = logging.getLogger("SLUGA_AUTH")


def generate_bot_token(prefix: str = "sluga") -> str:
    """
    Генерирует понятный и криптографически стойкий токен бота.
    Формат: sluga-XXXX-XXXXXX (легко скопировать и прочитать).
    Пример: sluga-7722-e4a8b1
    """
    # 4 цифры (например, короткий инстанс ID) + 6 hex-символов энтропии
    num_part = "".join(secrets.choice("0123456789") for _ in range(4))
    hex_part = secrets.token_hex(3)
    return f"{prefix}-{num_part}-{hex_part}"


def verify_bot_token(incoming_token: str) -> bool:
    """
    Безопасная сверка токена через hmac.compare_digest (защита от timing attacks).
    Токен берется исключительно из текущей конфигурации .env.
    """
    if not incoming_token:
        return False

    clean_incoming = incoming_token.strip()
    configured_token = getattr(settings, "sluga_bot_token", "sluga-core-token").strip()
    if not configured_token or configured_token == "sluga-core-token":
        return False

    allowed_tokens = [t.strip() for t in configured_token.split(",") if t.strip()]
    return any(hmac.compare_digest(clean_incoming, t) for t in allowed_tokens)


def get_or_create_bot_token() -> str:
    """
    Возвращает текущий токен из настроек или генерирует новый, если он пуст.
    """
    token = getattr(settings, "sluga_bot_token", "").strip()
    if not token or token == "sluga-core-token":
        token = generate_bot_token()
        settings.set_bot_token(token)
    return token


def rotate_token() -> str:
    """
    Перевыпуск токена (отзыв старого и генерация нового).
    """
    new_token = generate_bot_token()
    settings.set_bot_token(new_token)
    logger.info(f"Токен связи с ботом успешно обновлен: {new_token}")
    return new_token


