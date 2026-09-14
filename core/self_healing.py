"""
Контур самоисцеления Actor-Critic (Self-Healing Loop) агента SLUGA.
Реализует принцип «Никогда не останавливаться на ошибках»:
1. Перехват сбоя выполнения (Exit code != 0, Exception, Broken Build).
2. Локализация Root Cause по стектрейсу.
3. Точечный рефакторинг или исправление окружения.
4. Повтор до победного результата по стандарту Zero-False-Positive.
"""

import hashlib
import re
from typing import Dict, Any, Optional
from core.memory import SlugaMemory

class SelfHealingEngine:
    def __init__(self, memory: SlugaMemory):
        self.memory = memory

    def compute_signature(self, error_text: str) -> str:
        # Очищаем от временных меток и абсолютных путей для стабильного хэша
        normalized = re.sub(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}", "", error_text)
        normalized = re.sub(r"0x[0-9a-fA-F]+", "", normalized)
        normalized = re.sub(r"\s+", " ", normalized).strip()[:500]
        return hashlib.md5(normalized.encode("utf-8")).hexdigest()

    def inspect_failure(self, command: str, returncode: int, stdout: str, stderr: str) -> Dict[str, Any]:
        combined_err = f"{stderr}\n{stdout}".strip()
        sig = self.compute_signature(combined_err)
        past_cure = self.memory.find_past_cure(sig)

        return {
            "failed_command": command,
            "returncode": returncode,
            "error_signature": sig,
            "raw_error": combined_err[-2000:],
            "past_cure": past_cure,
            "has_known_fix": past_cure is not None
        }

    def record_success(self, error_signature: str, root_cause: str, fix_applied: str):
        self.memory.log_healing(
            error_signature=error_signature,
            root_cause=root_cause,
            fix_applied=fix_applied,
            success=True
        )
