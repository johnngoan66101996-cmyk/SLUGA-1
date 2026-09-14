"""
Инструмент выполнения команд в терминале и операций с файлами.
Поддерживает Windows (PowerShell) и Linux/macOS (Bash).
Содержит встроенную проверку безопасности (Защита от случайного удаления данных).
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
        proc = await asyncio.create_subprocess_exec(
            "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=work_dir
        )
    else:
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

def read_file(filepath: str, max_chars: int = 25000) -> str:
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
        return f"Файл успешно сохранен: {filepath} ({len(content)} символов)"
    except Exception as e:
        return f"Ошибка записи файла {filepath}: {e}"

def list_files(directory: str = ".") -> str:
    try:
        path = Path(directory)
        if not path.exists():
            return f"Директория {directory} не существует."
        items = list(path.iterdir())
        lines = []
        for item in sorted(items, key=lambda x: (not x.is_dir(), x.name)):
            prefix = "📁" if item.is_dir() else "📄"
            lines.append(f"{prefix} {item.name}")
        return "\n".join(lines) if lines else "Директория пуста."
    except Exception as e:
        return f"Ошибка чтения директории {directory}: {e}"
