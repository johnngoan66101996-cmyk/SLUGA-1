"""
Инструмент выполнения команд в терминале и операций с файлами.
Поддерживает Windows (PowerShell) и Linux/macOS (Bash).
Содержит встроенную проверку безопасности (Шаг 3 Триады: accidental-data-loss-prevention).
"""

import asyncio
import os
import sys
from pathlib import Path
from typing import Dict, Any, Optional

DANGEROUS_COMMANDS = [
    "rm -rf /",
    "format c:",
    "mkfs",
    "drop database",
    "gcloud projects delete",
]

async def execute_command(command: str, cwd: Optional[str] = None, timeout: int = 120) -> Dict[str, Any]:
    # 1. Проверка на катастрофические команды (Шаг 3 Триады)
    cmd_lower = command.lower()
    for danger in DANGEROUS_COMMANDS:
        if danger in cmd_lower:
            return {
                "command": command,
                "returncode": -1,
                "stdout": "",
                "stderr": f"БЛОКИРОВКА БЕЗОПАСНОСТИ: Обнаружена деструктивная команда '{danger}'. Требуется подтверждение.",
                "success": False
            }

    work_dir = cwd if cwd and Path(cwd).exists() else os.getcwd()

    is_windows = sys.platform == "win32"
    if is_windows:
        # Запуск через powershell.exe
        proc = await asyncio.create_subprocess_exec(
            "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=work_dir
        )
    else:
        # Запуск через bash / sh
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=work_dir
        )

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        stdout = stdout_bytes.decode("utf-8", errors="replace").strip()
        stderr = stderr_bytes.decode("utf-8", errors="replace").strip()
        returncode = proc.returncode or 0

        return {
            "command": command,
            "returncode": returncode,
            "stdout": stdout,
            "stderr": stderr,
            "success": returncode == 0
        }
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return {
            "command": command,
            "returncode": -1,
            "stdout": "",
            "stderr": f"Команда превысила лимит времени ({timeout} сек) и была остановлена.",
            "success": False
        }
    except Exception as e:
        return {
            "command": command,
            "returncode": -1,
            "stdout": "",
            "stderr": f"Ошибка запуска подпроцесса: {e}",
            "success": False
        }

def read_file(filepath: str, max_chars: int = 20000) -> str:
    path = Path(filepath)
    if not path.exists():
        return f"Файл {filepath} не найден."
    if not path.is_file():
        return f"Путь {filepath} не является файлом."
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(max_chars)
        return content
    except Exception as e:
        return f"Ошибка чтения файла {filepath}: {e}"

def write_file(filepath: str, content: str) -> str:
    try:
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Файл {filepath} успешно записан ({len(content)} символов)."
    except Exception as e:
        return f"Ошибка записи файла {filepath}: {e}"

def list_files(directory: str = ".", max_items: int = 50) -> str:
    try:
        path = Path(directory)
        if not path.exists():
            return f"Директория {directory} не существует."
        items = []
        for i, item in enumerate(path.iterdir()):
            if i >= max_items:
                items.append(f"... (еще {len(list(path.iterdir())) - max_items} элементов)")
                break
            prefix = "[DIR] " if item.is_dir() else "[FILE]"
            size = f"({item.stat().st_size} B)" if item.is_file() else ""
            items.append(f"{prefix} {item.name} {size}")
        return "\n".join(items) if items else "Директория пуста."
    except Exception as e:
        return f"Ошибка листинга директории {directory}: {e}"

def replace_file_content(filepath: str, target_content: str, replacement_content: str) -> str:
    """
    Хирургический инструмент: точечная замена существующего блока кода или текста (target_content)
    на новый (replacement_content) в файле без перезаписи всего файла.
    """
    path = Path(filepath)
    if not path.exists():
        return f"Хирургическая ошибка: файл {filepath} не найден."
    if not path.is_file():
        return f"Хирургическая ошибка: путь {filepath} не является файлом."
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        if target_content not in content:
            return f"Хирургическая ошибка: целевой фрагмент не найден в {filepath}. Убедитесь, что отступы и символы совпадают с содержимым файла."

        count = content.count(target_content)
        if count > 1:
            return f"Хирургическое предупреждение: целевой фрагмент найден {count} раз. Добавьте больше контекстных строк (выше или ниже), чтобы замена была однозначной."

        new_content = content.replace(target_content, replacement_content, 1)
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)

        return f"Хирургическая операция успешна: блок в {filepath} аккуратно заменен ({len(replacement_content)} симв.)."
    except Exception as e:
        return f"Хирургическая ошибка при модификации {filepath}: {e}"

