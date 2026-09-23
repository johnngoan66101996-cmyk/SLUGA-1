"""
Динамический On-Demand загрузчик 115 инженерных навыков агента SLUGA.
Сканирует локальную папку ./skills/, кэширует метаданные и загружает
полный регламент (SKILL.md) только при фактической необходимости.
Экономит контекстное окно и оперативную память.
"""

import re
from pathlib import Path
from typing import Dict, List, Optional, Any

class SkillLoader:
    def __init__(self, skills_dir: Optional[str] = None):
        if skills_dir:
            self.skills_dir = Path(skills_dir)
        else:
            self.skills_dir = Path(__file__).resolve().parent.parent / "skills"
        
        self._index: Dict[str, Dict[str, Any]] = {}
        self._build_index()

    def _build_index(self):
        if not self.skills_dir.exists():
            return

        for skill_path in self.skills_dir.iterdir():
            if skill_path.is_dir():
                skill_md = skill_path / "SKILL.md"
                if skill_md.exists():
                    name = skill_path.name
                    desc = self._extract_description(skill_md)
                    self._index[name] = {
                        "name": name,
                        "path": str(skill_md),
                        "description": desc
                    }

    def _extract_description(self, file_path: Path) -> str:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read(2048) # Читаем только заголовок и frontmatter

            # 1. Попытка извлечь из YAML frontmatter
            if content.startswith("---"):
                match = re.search(r"description:\s*([^\n\r]+)", content)
                if match:
                    return match.group(1).strip()

            # 2. Иначе берем первую строку после H1
            lines = [line.strip() for line in content.splitlines() if line.strip()]
            for i, line in enumerate(lines):
                if line.startswith("# "):
                    if i + 1 < len(lines):
                        return lines[i + 1].lstrip("> #*- ")
                    return line
            return lines[0] if lines else "Инженерный навык SLUGA"
        except Exception:
            return "Инженерный навык SLUGA"

    def list_skills(self) -> List[Dict[str, str]]:
        return [{"name": v["name"], "description": v["description"]} for v in self._index.values()]

    def get_skill_content(self, skill_name: str) -> Optional[str]:
        skill_info = self._index.get(skill_name)
        if not skill_info:
            # Нечеткий поиск
            for k, v in self._index.items():
                if skill_name.lower() in k.lower():
                    skill_info = v
                    break
        if not skill_info:
            return None

        try:
            with open(skill_info["path"], "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            return f"Ошибка чтения навыка {skill_name}: {e}"

    def search_skills(self, query: str, top_k: int = 5) -> List[Dict[str, str]]:
        query_words = set(re.findall(r"\w+", query.lower()))
        scores = []
        for name, info in self._index.items():
            text = f"{name} {info['description']}".lower()
            score = sum(1 for w in query_words if w in text)
            if score > 0:
                scores.append((score, info))

        scores.sort(key=lambda x: x[0], reverse=True)
        return [{"name": s[1]["name"], "description": s[1]["description"]} for s in scores[:top_k]]
