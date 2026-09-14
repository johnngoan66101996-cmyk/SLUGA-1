"""
Многослойная память агента SLUGA.
Построена на базе легковесного SQLite в режиме WAL (Write-Ahead Logging):
1. Short-Term Memory (STM): сессии, история сообщений, мысли и вызовы инструментов.
2. Long-Term Memory (LTM): факты, правила пользователя, извлеченные уроки самоисцеления.
Потребление RAM: ~10-20 МБ.
"""

import sqlite3
import json
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

class SlugaMemory:
    def __init__(self, db_path: str = "./data/sluga_memory.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # WAL-режим для многопоточности и максимальной скорости без блокировок
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self):
        with self._get_connection() as conn:
            # 1. Краткосрочная память (диалоги и шаги рассуждений)
            conn.execute("""
            CREATE TABLE IF NOT EXISTS conversation_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_calls TEXT,
                created_at REAL NOT NULL
            );
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_session ON conversation_history(session_id);")

            # 2. Долгосрочная память (знания, факты, паттерны)
            conn.execute("""
            CREATE TABLE IF NOT EXISTS long_term_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                key TEXT NOT NULL UNIQUE,
                value TEXT NOT NULL,
                confidence REAL DEFAULT 1.0,
                updated_at REAL NOT NULL
            );
            """)

            # 3. Журнал самоисцеления (Actor-Critic Self-Healing Log)
            conn.execute("""
            CREATE TABLE IF NOT EXISTS healing_journal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                error_signature TEXT NOT NULL,
                root_cause TEXT NOT NULL,
                fix_applied TEXT NOT NULL,
                success INTEGER NOT NULL,
                created_at REAL NOT NULL
            );
            """)
            conn.commit()

    # --- Short-Term Memory (STM) ---
    def add_message(self, session_id: str, role: str, content: str, tool_calls: Optional[List[Dict[str, Any]]] = None):
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO conversation_history (session_id, role, content, tool_calls, created_at) VALUES (?, ?, ?, ?, ?)",
                (session_id, role, content, json.dumps(tool_calls, ensure_ascii=False) if tool_calls else None, time.time())
            )
            conn.commit()

    def get_history(self, session_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT role, content, tool_calls FROM conversation_history WHERE session_id = ? ORDER BY id DESC LIMIT ?",
                (session_id, limit)
            )
            rows = cursor.fetchall()
            messages = []
            for r in reversed(rows):
                msg: Dict[str, Any] = {"role": r["role"], "content": r["content"]}
                if r["tool_calls"]:
                    msg["tool_calls"] = json.loads(r["tool_calls"])
                messages.append(msg)
            return messages

    def clear_history(self, session_id: str):
        with self._get_connection() as conn:
            conn.execute("DELETE FROM conversation_history WHERE session_id = ?", (session_id,))
            conn.commit()

    # --- Long-Term Memory (LTM) ---
    def remember_fact(self, category: str, key: str, value: str):
        with self._get_connection() as conn:
            conn.execute("""
            INSERT INTO long_term_memory (category, key, value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at;
            """, (category, key, value, time.time()))
            conn.commit()

    def recall_facts(self, category: Optional[str] = None) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            if category:
                cursor = conn.execute("SELECT category, key, value FROM long_term_memory WHERE category = ?", (category,))
            else:
                cursor = conn.execute("SELECT category, key, value FROM long_term_memory")
            return [{"category": r["category"], "key": r["key"], "value": r["value"]} for r in cursor.fetchall()]

    # --- Self-Healing History ---
    def log_healing(self, error_signature: str, root_cause: str, fix_applied: str, success: bool = True):
        self.log_healing_event(error_signature, root_cause, fix_applied, success)

    def log_healing_event(self, error_signature: str, root_cause: str, fix_applied: str, success: bool):
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO healing_journal (error_signature, root_cause, fix_applied, success, created_at) VALUES (?, ?, ?, ?, ?)",
                (error_signature, root_cause, fix_applied, 1 if success else 0, time.time())
            )
            conn.commit()

    def find_past_cure(self, error_signature: str) -> Optional[str]:
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT fix_applied FROM healing_journal WHERE error_signature = ? AND success = 1 ORDER BY id DESC LIMIT 1",
                (error_signature,)
            )
            row = cursor.fetchone()
            return row["fix_applied"] if row else None
