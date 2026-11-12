"""SQLAlchemy engine, session factory and declarative base."""

from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# check_same_thread=False lets FastAPI's threadpool use the SQLite file concurrently
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def ensure_sqlite_columns() -> None:
    """Idempotent additive migrations for databases created before a column shipped.

    `create_all` never alters existing tables, so a new nullable-with-default
    column needs one explicit ALTER. Safe to run on every startup: the PRAGMA
    check makes it a no-op once the column exists.
    """
    if not settings.database_url.startswith("sqlite"):
        return
    with engine.begin() as conn:
        columns = {row[1] for row in conn.execute(text("PRAGMA table_info(llm_task_configs)"))}
        if "effort" not in columns:
            conn.execute(text("ALTER TABLE llm_task_configs ADD COLUMN effort VARCHAR(32) NOT NULL DEFAULT ''"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
