"""
Центральный мозг агента SLUGA (ReAct Engine + LiteAI Gateway).
1. Официальный провайдер: LiteAI (https://liteai.tech/docs) — Claude Sonnet 4.6, GPT-5.6, DeepSeek без VPN.
2. Автономный ReAct-цикл выполнения задач с вызовом инструментов.
3. Долговременная сессионная память SQLite WAL.
4. Контур самоисцеления Actor-Critic (не останавливаться при сбоях).
"""

import asyncio
import json
import logging
from typing import Dict, Any, List, Optional
import httpx

from config import settings, LITEAI_MODELS_CATALOG
from core.memory import SlugaMemory
from core.self_healing import SelfHealingEngine
from tools.terminal_runner import execute_command, read_file, write_file, list_files
from tools.claw_search import claw_search, fetch_page

logger = logging.getLogger("SLUGA_ENGINE")

SYSTEM_PROMPT = """Ты — SLUGA, автономный элитный инженер искусственного интеллекта, системный архитектор и старший разработчик полного цикла.

ГЛАВНЫЕ ПРИНЦИПЫ РАБОТЫ:
1. НИКАКИХ ЗАГЛУШЕК: Ты пишешь только полностью рабочий, боевой код под ключ. Никаких '// TODO: допиши сам' или '...остальной код...'.
2. ПРИНЦИП САМОИСЦЕЛЕНИЯ (ACTOR-CRITIC): Если команда, тест или сборка падают с ошибкой — ты НИКОГДА НЕ ОСТАНАВЛИВАЕШЬСЯ и не перекладываешь решение на пользователя. Ты мгновенно анализируешь стек-трейс сбоя, локализуешь первопричину (Root Cause), применяешь точечное исправление в коде или окружении и повторяешь команду до победного результата.
3. БЕЗОПАСНОСТЬ: Перед внесением рискованных изменений проверяй пути файлов и не удаляй критические данные.
4. ЯЗЫК: Общайся на грамотном русском языке. Отвечай прямо, точно, структурируя выводы в Markdown с кликабельными ссылками на файлы.
"""

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "execute_command",
            "description": "Выполнить команду в терминале (Bash на сервере или PowerShell на ПК).",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Командная строка для запуска"}
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Прочитать содержимое файла с диска.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {"type": "string", "description": "Путь к файлу"}
                },
                "required": ["filepath"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Записать или перезаписать файл с полным рабочим кодом под ключ.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {"type": "string", "description": "Путь к файлу"},
                    "content": {"type": "string", "description": "Полный рабочий текст файла"}
                },
                "required": ["filepath", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "Показать список файлов и папок в указанной директории.",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {"type": "string", "description": "Директория для просмотра (по умолчанию '.')"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Поиск актуальной информации и документации в интернете.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Поисковый запрос"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_page",
            "description": "Загрузить текст веб-страницы по URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL страницы для чтения"}
                },
                "required": ["url"]
            }
        }
    }
]


class SlugaEngine:
    def __init__(self):
        self.memory = SlugaMemory(settings.sqlite_db_path)
        self.healer = SelfHealingEngine(self.memory)

    async def _dispatch_tool_call(self, tool_name: str, tool_args: Dict[str, Any]) -> str:
        """Безопасный вызов локального инструмента агента."""
        try:
            if tool_name == "execute_command":
                cmd = tool_args.get("command", "")
                res = await execute_command(cmd)
                if not res["success"] and res["stderr"]:
                    # Активация контура самоисцеления
                    inspection = self.healer.inspect_failure(cmd, res["returncode"], res["stdout"], res["stderr"])
                    cure_hint = f"\n[Ранее примененное решение: {inspection['past_cure']}]" if inspection["past_cure"] else ""
                    return f"Ошибка команды (код {res['returncode']}):\n{res['stderr']}{cure_hint}\nВывод:\n{res['stdout']}"
                return res["stdout"] if res["stdout"] else (res["stderr"] if res["stderr"] else "Команда успешно выполнена без вывода.")

            elif tool_name == "read_file":
                return read_file(tool_args.get("filepath", ""))

            elif tool_name == "write_file":
                return write_file(tool_args.get("filepath", ""), tool_args.get("content", ""))

            elif tool_name == "list_files":
                return list_files(tool_args.get("directory", "."))

            elif tool_name == "web_search":
                res = await claw_search(tool_args.get("query", ""))
                return json.dumps(res, ensure_ascii=False, indent=2)

            elif tool_name == "fetch_page":
                return await fetch_page(tool_args.get("url", ""))

            else:
                return f"Неизвестный инструмент: {tool_name}"

        except Exception as e:
            logger.exception(f"Исключение при вызове инструмента {tool_name}")
            return f"Ошибка вызова {tool_name}: {e}"

    async def _call_llm_api(self, messages: List[Dict[str, Any]], model_name: str, api_key: str) -> Dict[str, Any]:
        """Прямой защищенный запрос к шлюзу LiteAI."""
        url = f"{settings.liteai_base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model_name,
            "messages": messages,
            "tools": TOOL_DEFINITIONS,
            "tool_choice": "auto",
            "temperature": 0.2
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code != 200:
                err_body = resp.text
                try:
                    err_json = resp.json()
                    err_msg = err_json.get("error", {}).get("message", err_body)
                except Exception:
                    err_msg = err_body
                raise RuntimeError(f"LiteAI HTTP {resp.status_code}: {err_msg}")
            return resp.json()

    async def process_user_request(
        self,
        session_id: str,
        user_prompt: str,
        status_callback = None
    ) -> str:
        """
        Главный автономный ReAct-цикл обработки пользовательского запроса.
        """
        # Обработка встроенных системных команд Telegram
        clean_cmd = user_prompt.strip().lower()

        if clean_cmd == "/start":
            return (
                "👋 Привет! Я — **SLUGA**, автономный инженерный AI-агент.\n\n"
                "⚡ **Возможности:**\n"
                "• Выполнение задач в шелле и терминале серверов.\n"
                "• Полный цикл кодинга, рефакторинг и исправление багов под ключ.\n"
                "• Обработка голосовых сообщений и файлов со скрепки 📎.\n"
                "• Долговременная память диалогов и контекста (SQLite).\n\n"
                "Для выбора модели LiteAI используйте `/model`, для проверки системы — `/status`."
            )

        if clean_cmd == "/model":
            catalog_lines = ["🧠 **Официальные модели LiteAI (liteai.tech):**\n"]
            for mid, mdata in LITEAI_MODELS_CATALOG.items():
                active_mark = " (ТЕКУЩАЯ)" if mid == settings.liteai_model else ""
                catalog_lines.append(f"• **{mid}**{active_mark}\n  _{mdata['description']}_\n  Расход: {mdata['consumption']}\n")
            catalog_lines.append("Для смены модели выберите её в настройках или укажите в запросе.")
            return "\n".join(catalog_lines)

        if clean_cmd == "/status":
            meta = LITEAI_MODELS_CATALOG.get(settings.liteai_model, {})
            tier_info = meta.get("consumption", "Стандартный")
            token_display = settings.sluga_bot_token[:10] + "..." if len(settings.sluga_bot_token) > 10 else settings.sluga_bot_token
            return (
                "📊 **Статус серверного агента SLUGA:**\n\n"
                f"• **Статус:** 🟢 Онлайн (FastAPI + WebSockets)\n"
                f"• **Активная модель:** `{settings.liteai_model}`\n"
                f"• **Расход токенов:** {tier_info}\n"
                f"• **Токен связи:** `{token_display}`\n"
                f"• **Память:** SQLite WAL (активна)\n"
                f"• **Шлюз:** LiteAI Gateway (`{settings.liteai_base_url}`)"
            )

        if clean_cmd == "/help":
            return (
                "❓ **Справка по командам SLUGA:**\n\n"
                "• `/start` — запустить бота и приветствие\n"
                "• `/model` — каталог доступных моделей LiteAI и расход токенов\n"
                "• `/status` — статус сервера, текущая модель и канал связи\n"
                "• `/new` — начать новый диалог с чистого листа\n"
                "• `/help` — показать эту справку\n\n"
                "Также вы можете отправлять любые текстовые задачи, код для аудита, файлы или голосовые сообщения."
            )

        # 1. Проверяем наличие ключа LiteAI
        api_key = settings.liteai_api_key
        if not api_key:
            return (
                "⚠️ **LiteAI API Key не настроен!**\n\n"
                "Для работы агента укажите ваш единый ключ формата `sk-bf-...` от сервиса [liteai.tech](https://liteai.tech/docs).\n\n"
                "Указать ключ можно в файле `.env` на сервере (`LITEAI_API_KEY=sk-bf-...`) или через настройки приложения."
            )

        # 2. Сохраняем запрос пользователя в память
        self.memory.add_message(session_id, "user", user_prompt)

        # 3. Собираем контекст диалога
        history = self.memory.get_history(session_id, limit=20)
        messages: List[Dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]

        for h in history:
            msg_dict: Dict[str, Any] = {"role": h["role"], "content": h["content"]}
            if h.get("tool_calls"):
                msg_dict["tool_calls"] = h["tool_calls"]
            messages.append(msg_dict)

        model_name = settings.liteai_model
        steps = 0
        max_steps = settings.max_react_steps

        # 4. Автономный ReAct цикл (Reasoning + Acting)
        while steps < max_steps:
            steps += 1

            if status_callback:
                await status_callback(f"🧠 Анализ задачи (шаг {steps}/{max_steps})...")

            try:
                llm_response = await self._call_llm_api(messages, model_name=model_name, api_key=api_key)
            except Exception as e:
                logger.error(f"Ошибка LLM на шаге {steps}: {e}")
                return f"⚠️ Ошибка обращения к нейросети LiteAI ({model_name}): {e}"

            choice = llm_response.get("choices", [{}])[0]
            message = choice.get("message", {})
            content = message.get("content") or ""
            tool_calls = message.get("tool_calls") or []

            # Добавляем шаг ассистента в контекст текущей итерации
            assistant_msg: Dict[str, Any] = {"role": "assistant"}
            if content:
                assistant_msg["content"] = content
            if tool_calls:
                assistant_msg["tool_calls"] = tool_calls
            messages.append(assistant_msg)

            # Если инструментов нет — агент сформировал финальный ответ
            if not tool_calls:
                self.memory.add_message(session_id, "assistant", content)
                return content

            # Выполняем запрошенные агентом инструменты
            for tc in tool_calls:
                func = tc.get("function", {})
                fn_name = func.get("name", "")
                try:
                    fn_args = json.loads(func.get("arguments", "{}"))
                except Exception:
                    fn_args = {}

                if status_callback:
                    await status_callback(f"🛠️ Выполняю инструмент: {fn_name}...")

                logger.info(f"[ReAct Step {steps}] Calling tool '{fn_name}' with args {fn_args}")
                tool_result = await self._dispatch_tool_call(fn_name, fn_args)

                # Добавляем наблюдение (Observation) в контекст
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", f"call_{steps}"),
                    "name": fn_name,
                    "content": str(tool_result)
                })

        # Если лимит шагов исчерпан
        fallback_msg = content if content else "Задача потребовала слишком много шагов и была остановлена для безопасности."
        self.memory.add_message(session_id, "assistant", fallback_msg)
        return fallback_msg
