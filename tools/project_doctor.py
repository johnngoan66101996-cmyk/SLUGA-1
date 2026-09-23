"""
Инструмент «Project Doctor» (МРТ проекта) — Шаг 2 Золотой Триады агента SLUGA.
Сканирует репозиторий, определяет стек технологий, состояние версионного контроля
и наличие узких мест до начала активных модификаций.
"""

from pathlib import Path
from typing import Dict, Any, List

def diagnose_project(target_dir: str = ".") -> Dict[str, Any]:
    base = Path(target_dir).resolve()
    
    # 1. Проверка Git
    has_git = (base / ".git").exists()
    
    # 2. Определение стека и конфигураций
    manifests = []
    stack = []
    
    checks = {
        "package.json": ("Node.js / JavaScript / TypeScript", "npm / pnpm / yarn"),
        "pubspec.yaml": ("Flutter / Dart", "flutter pub / dart pub"),
        "pyproject.toml": ("Python (Poetry / Flit / Hatch)", "pip / uv"),
        "requirements.txt": ("Python (pip)", "pip install"),
        "Pipfile": ("Python (Pipenv)", "pipenv"),
        "Cargo.toml": ("Rust", "cargo"),
        "go.mod": ("Go", "go modules"),
        "pom.xml": ("Java (Maven)", "mvn"),
        "build.gradle": ("Java / Kotlin / Android (Gradle)", "gradle"),
        "docker-compose.yml": ("Docker Compose", "docker compose"),
        "Dockerfile": ("Docker", "docker build"),
    }
    
    for filename, (tech, manager) in checks.items():
        if (base / filename).exists():
            manifests.append(filename)
            stack.append(f"{tech} ({manager})")
            
    # 3. Поиск тестов
    test_dirs = ["test", "tests", "__tests__", "spec"]
    found_test_dirs = [d for d in test_dirs if (base / d).exists()]
    
    # 4. Формирование отчета МРТ
    report = {
        "project_root": str(base),
        "has_git_vcs": has_git,
        "manifests_detected": manifests,
        "detected_stack": stack or ["Неопределенный стек (стандартная файловая система)"],
        "test_directories": found_test_dirs,
        "safety_recommendation": (
            "✅ Проект готов к хирургическому вмешательству."
            if has_git else
            "⚠️ ВНИМАНИЕ: Репозиторий Git не инициализирован! Рекомендуется выполнить 'git init' перед правками."
        )
    }
    
    return report
