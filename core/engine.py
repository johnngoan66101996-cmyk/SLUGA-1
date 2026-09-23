"""
Центральный мозг агента SLUGA (ReAct Engine + LiteAI Gateway + Хирургический комплекс).
1. Официальный провайдер: LiteAI (https://liteai.tech/docs) — Claude Sonnet 4.6, GPT-5.6, DeepSeek без VPN.
2. Автономный ReAct-цикл выполнения задач с вызовом 9 хирургических и системных инструментов.
3. On-Demand доступ к каталогу из 116 инженерных навыков SLUGA (skills/).
4. Долговременная сессионная память SQLite WAL (Гибридная память: экономия RAM ~50 МБ).
5. Контур самоисцеления Actor-Critic (не останавливаться при сбоях).
"""

import asyncio
import json
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path
import httpx

from config import settings, LITEAI_MODELS_CATALOG
from core.memory import SlugaMemory
from core.self_healing import SelfHealingEngine
from core.skill_loader import SkillLoader
from tools.terminal_runner import execute_command, read_file, write_file, replace_file_content, list_files
from tools.claw_search import claw_search, fetch_page
from tools.project_doctor import diagnose_project

logger = logging.getLogger("SLUGA_ENGINE")

SYSTEM_PROMPT = """Ты — SLUGA, автономный элитный агент и старший инженер-хирург искусственного интеллекта (Full-Stack / Mobile Flutter / Cloud / BigQuery / Firebase / Data Engineering / DevOps / AI).

ТВОЕ ОКРУЖЕНИЕ И СТАТУС:
1. Твой бэкенд развернут и работает круглосуточно 24/7 на сервере (доступен через веб-интерфейс и приложение SlugaGram).
2. Архитектура: «Вариант 2: Гибридная память». Полная история надежно хранится на клиенте в приложении SlugaGram (на телефоне и ПК пользователя), а на сервере поддерживается легкий контекст диалога в SQLite WAL, обеспечивая работу в пределах ~50 МБ RAM.
3. Мыслительный интеллект: модель gpt-5.6-sol (или выбранная пользователем) через шлюз LiteAI.

ТВОЙ АРСЕНАЛ ИНСТРУМЕНТОВ И СКИЛОВ:
Ты обладаешь 9 встроенными инструментами прямого действия и каталогом из 116 специализированных инженерных навыков:
1. ВСТРОЕННЫЕ ИНСТРУМЕНТЫ (9 инструментов):
   - `execute_command` — выполнение команд в терминале (Linux Bash на сервере / PowerShell на ПК) с защитой от деструктивных операций.
   - `read_file` — чтение файлов с диска.
   - `write_file` — создание и полная запись файлов под ключ (без заглушек).
   - `replace_file_content` — ХИРУРГИЧЕСКИЙ СКАЛЬПЕЛЬ: точечная замена блоков кода или строк в файле без перезаписи всего файла, сохраняющая контекст, форматирование и комментарии.
   - `list_files` — листинг файлов и папок в директориях.
   - `web_search` — поиск актуальной документации, библиотек и решений в интернете (DuckDuckGo).
   - `fetch_page` — скачивание веб-страниц и извлечение контента.
   - `project_mri` — МРТ ПРОЕКТА (Шаг 2 Золотой Триады: сканирование манифестов package.json/pubspec.yaml/etc, состояния Git и готовности к хирургическому вмешательству).
   - `consult_skill` — динамический On-Demand доступ к регламентам любого из 116 навыков SLUGA.

2. КАТАЛОГ ИЗ 116 СПЕЦИАЛИЗИРОВАННЫХ НАВЫКОВ (папка skills/):
   - Мобильная разработка: Flutter (flutter-fix-layout-issues, flutter-build-responsive-layout, flutter-setup-declarative-routing, flutter-add-widget-test, flutter-apply-architecture-best-practices и др.), Dart (dart-run-static-analysis, dart-add-unit-test, dart-use-pattern-matching и др.), Android CLI, iOS/Xcode.
   - Облако и БД: Firebase (firestore, auth, app-hosting, security-rules-auditor, crashlytics), Google Cloud (BigQuery SQL, Dataform, dbt, Spark, Dataflow, Cloud Storage, DTS, Composer/Airflow).
   - Автономность, защита и интеллект: Золотая Триада хирурга (finch-sandbox, project-doctor, accidental-data-loss-prevention), самоисцеление (self-reflection-healing-loop), антидетект-автоматизация (anti-detect-browser), autonomous mission runner (termit-autonomous-mission-runner), Gemini API, научные базы данных (UniProt, PDB, ChEMBL, PubMed).

ГЛАВНЫЕ ПРИНЦИПЫ РАБОТЫ:
1. НИКАКИХ ЗАГЛУШЕК: Ты пишешь только полностью рабочий, боевой код под ключ. Никаких '// TODO: допиши сам' или '...остальной код...'.
2. ЗОЛОТАЯ ТРИАДА ПЕРЕД ВМЕШАТЕЛЬСТВОМ:
   - Шаг 1: Стерильная среда и изоляция (finch-sandbox).
   - Шаг 2: МРТ проекта (project_mri) — диагностика стека и версионности.
   - Шаг 3: «Не навреди» — не удаляй критические данные без бэкапа (accidental-data-loss-prevention).
3. ПРИНЦИП САМОИСЦЕЛЕНИЯ (ACTOR-CRITIC): Если команда, тест или сборка падают с ошибкой — ты НИКОГДА НЕ ОСТАНАВЛИВАЕШЬСЯ и не перекладываешь проблему на пользователя. Анализируй ошибку, примени точечный фикс и повтори команду до победного результата.
4. ОТВЕТ НА ВОПРОСЫ О НАБОРЕ ИНСТРУМЕНТОВ/СКИЛОВ: Четко перечисляй свои 9 встроенных хирургических инструментов и сообщай о каталоге из 116 навыков, готовых к загрузке через `consult_skill`.
5. ЯЗЫК: Общайся на грамотном, уверенном русском языке. Форматируй ответы в Markdown.
"""

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "execute_command",
            "description": "Выполнить команду в терминале (Bash на Linux сервере или PowerShell на ПК).",
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
            "description": "Записать или перезаписать файл с полным рабочим кодом под ключ (без заглушек).",
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
            "name": "replace_file_content",
            "description": "Хирургический инструмент: точечная замена существующего блока кода или текста на новый в файле без перезаписи всего остального файла.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {"type": "string", "description": "Путь к файлу"},
                    "target_content": {"type": "string", "description": "Точный существующий фрагмент текста/кода для замены"},
                    "replacement_content": {"type": "string", "description": "Новый фрагмент текста/кода"}
                },
                "required": ["filepath", "target_content", "replacement_content"]
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
            "description": "Поиск актуальной информации, документации и решений в интернете (DuckDuckGo).",
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
            "description": "Загрузить текст веб-страницы по URL и извлечь полезный контент.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL страницы для чтения"}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "project_mri",
            "description": "Выполнить диагностику и МРТ проекта (Шаг 2 Золотой Триады: стек, Git, файлы сборки и готовность к хирургическому вмешательству).",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_dir": {"type": "string", "description": "Целевая папка проекта (по умолчанию '.')"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "consult_skill",
            "description": "Загрузить подробный регламент (SKILL.md) любого из 116 инженерных навыков SLUGA On-Demand.",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {"type": "string", "description": "Название навыка (например: flutter-fix-layout-issues, bigquery-sql, anti-detect-browser, finch-sandbox, project-doctor, accidental-data-loss-prevention)"}
                },
                "required": ["skill_name"]
            }
        }
    }
]


class SlugaEngine:
    def __init__(self):
        self.memory = SlugaMemory(settings.sqlite_db_path)
        self.healer = SelfHealingEngine(self.memory)
        self.skill_loader = SkillLoader()

    async def _dispatch_tool_call(self, tool_name: str, tool_args: Dict[str, Any]) -> str:
        """Безопасный вызов локального хирургического или системного инструмента агента."""
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

            elif tool_name == "replace_file_content":
                return replace_file_content(
                    tool_args.get("filepath", ""),
                    tool_args.get("target_content", ""),
                    tool_args.get("replacement_content", "")
                )

            elif tool_name == "list_files":
                return list_files(tool_args.get("directory", "."))

            elif tool_name == "web_search":
                res = await claw_search(tool_args.get("query", ""))
                return json.dumps(res, ensure_ascii=False, indent=2)

            elif tool_name == "fetch_page":
                return await fetch_page(tool_args.get("url", ""))

            elif tool_name == "project_mri":
                res = diagnose_project(tool_args.get("target_dir", "."))
                return json.dumps(res, ensure_ascii=False, indent=2)

            elif tool_name == "consult_skill":
                s_name = tool_args.get("skill_name", "")
                content = self.skill_loader.get_skill_content(s_name)
                if content:
                    return f"=== РЕГЛАМЕНТ НАВЫКА {s_name} ===\n\n{content[:6000]}"
                available = [s["name"] for s in self.skill_loader.list_skills()[:25]]
                return f"Навык '{s_name}' не найден. Доступно 116 навыков, например: {', '.join(available)}..."

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
        clean_model = model_name.strip().strip("<>").strip()
        payload = {
            "model": clean_model,
            "messages": messages,
            "tools": TOOL_DEFINITIONS,
            "tool_choice": "auto",
            "temperature": 0.2,
            "max_tokens": 4096
        }

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
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
        except httpx.TimeoutException:
            raise TimeoutError(f"Превышено время ожидания LiteAI ({model_name}, таймаут 45с). Рекомендуется переключить модель на gpt-5.6-sol.")

    async def process_user_request(
        self,
        session_id: str,
        user_prompt: str,
        status_callback = None
    ) -> str:
        """
        Главный автономный ReAct-цикл обработки пользовательского запроса.
        """
        clean_cmd = user_prompt.strip().lower()

        if clean_cmd == "/start":
            return (
                "👋 Привет! Я — **SLUGA**, автономный элитный инженер-хирург ИИ.\n\n"
                "⚡ **Мой арсенал:**\n"
                "• **9 встроенных инструментов прямого действия:** терминал Bash, чтение/запись файлов, хирургический скальпель `replace_file_content`, листинг директорий, веб-поиск DuckDuckGo, чтение веб-страниц, МРТ проекта `project_mri` и On-Demand загрузчик навыков `consult_skill`.\n"
                "• **Каталог 116 инженерных навыков:** Flutter/Dart, Firebase, BigQuery, Золотая Триада, самоисцеление Actor-Critic, биоинженерия и облачные пайплайны.\n"
                "• **Круглосуточный режим 24/7** на удаленном сервере или локальном ПК.\n\n"
                "Для выбора модели LiteAI используйте `/model`, для проверки системы — `/status`, для списка навыков — `/skills`."
            )

        if clean_cmd == "/skills":
            skills = self.skill_loader.list_skills()
            if not skills:
                return "Каталог навыков пуст или инициализируется."
            lines = [f"📚 **Каталог инженерных навыков SLUGA (всего {len(skills)} навыков):**\n"]
            for s in skills[:30]:
                lines.append(f"• `{s['name']}` — _{s['description']}_")
            if len(skills) > 30:
                lines.append(f"\n_...и еще {len(skills) - 30} навыков. Загрузка любого регламента: `consult_skill(skill_name)`._")
            return "\n".join(lines)

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
            skill_count = len(self.skill_loader.list_skills())
            return (
                "📊 **Статус серверного агента SLUGA:**\n\n"
                f"• **Статус:** 🟢 Онлайн 24/7 (SpaceWeb Uvicorn)\n"
                f"• **Активная модель:** `{settings.liteai_model}`\n"
                f"• **Расход токенов:** {tier_info}\n"
                f"• **Инструментов прямого действия:** 9 (включая хирургический `replace_file_content` и `project_mri`)\n"
                f"• **Инженерных навыков:** {skill_count} (On-Demand доступ)\n"
                f"• **Токен связи:** `{token_display}`\n"
                f"• **Память:** SQLite WAL (Гибридная, скользящее окно 15 сообщений)\n"
                f"• **Шлюз:** LiteAI Gateway (`{settings.liteai_base_url}`)"
            )

        if clean_cmd == "/help":
            return (
                "❓ **Справка по командам SLUGA:**\n\n"
                "• `/start` — запустить бота и приветствие\n"
                "• `/skills` — каталог инженерных навыков (116 навыков)\n"
                "• `/model` — каталог доступных моделей LiteAI и расход токенов\n"
                "• `/status` — статус сервера, текущая модель и канал связи\n"
                "• `/new` — начать новый диалог с чистого листа\n"
                "• `/help` — показать эту справку\n\n"
                "Также вы можете отправлять любые текстовые задачи, код для аудита, файлы со скрепки или голосовые сообщения."
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

        # 3. Собираем контекст диалога (скользящее окно 15 сообщений для памяти Variant 2)
        history = self.memory.get_history(session_id, limit=15)
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
