"""Tool registry: maps the `tool` string stored on Job rows to runner classes.

Adding a tool = one `@register("name")` line on a BaseRunner subclass. The
orchestrator schedules runners purely through this registry.
"""

from __future__ import annotations

from app.scanner.base import BaseRunner

_RUNNERS: dict[str, type[BaseRunner]] = {}


def register(name: str):
    def decorator(cls: type[BaseRunner]) -> type[BaseRunner]:
        if name in _RUNNERS:
            raise ValueError(f"Duplicate runner registration: {name}")
        cls.name = name
        _RUNNERS[name] = cls
        return cls

    return decorator


def get_runner(name: str) -> type[BaseRunner]:
    if name not in _RUNNERS:
        raise KeyError(f"No runner registered for tool '{name}'")
    return _RUNNERS[name]


def registered_tools() -> list[str]:
    return list(_RUNNERS)


# Import runners so their @register decorators run. Keep alphabetical.
def _load_runners() -> None:
    from app.scanner import dns_runner, nmap_runner, prober, zap_runner  # noqa: F401


_load_runners()
