"""SQLAlchemy engine, session factory and declarative base."""

from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

_IS_SQLITE = settings.database_url.startswith("sqlite")

# check_same_thread=False lets FastAPI's threadpool use the SQLite file concurrently
connect_args = {"check_same_thread": False} if _IS_SQLITE else {}

engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


if _IS_SQLITE:

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
        """Per-connection PRAGMAs (F-39).

        WAL lets the report/scan workers and SSE readers work concurrently
        instead of serialising on one rollback journal, `busy_timeout` makes a
        writer wait for the current write transaction instead of failing with
        "database is locked" immediately, and NORMAL is the safe synchronous
        mode for WAL.

        Foreign keys are deliberately NOT enabled here: the declared FKs have no
        cascade rules yet, so turning enforcement on would make target deletion
        fail instead of orphaning. That remains a separate, documented task.
        """
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")  # milliseconds
            cursor.execute("PRAGMA synchronous=NORMAL")
        finally:
            cursor.close()


class Base(DeclarativeBase):
    pass


def ensure_sqlite_columns() -> None:
    """Idempotent additive migrations for databases created before a column shipped.

    `create_all` never alters existing tables, so a new nullable-with-default
    column needs one explicit ALTER. Safe to run on every startup: the PRAGMA
    check makes each migration a no-op once the column exists.
    """
    if not _IS_SQLITE:
        return
    with engine.begin() as conn:
        columns = {row[1] for row in conn.execute(text("PRAGMA table_info(llm_task_configs)"))}
        if "effort" not in columns:
            conn.execute(text("ALTER TABLE llm_task_configs ADD COLUMN effort VARCHAR(32) NOT NULL DEFAULT ''"))

        # F-38: existing users start at version 0. A token issued before this
        # deploy carries no `tv` claim and is rejected, so every live session is
        # logged out exactly once - which is the point of enabling revocation.
        user_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(users)"))}
        if "token_version" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0"))


def ensure_sqlite_indexes() -> None:
    """Additive DDL that `create_all` cannot express: the partial unique index
    behind report idempotency (F-40).

    `api/reports.py` checks for a live pending row before inserting, but two
    requests that arrive inside the same window can both pass the check - SQLite
    offers no row lock there. This index makes the second insert fail, and the
    endpoint turns that IntegrityError into "return the existing row".

    Databases that already contain duplicate pending rows cannot take the index,
    so the older duplicates are settled to `failed` first (the newest pending row
    per assessment is kept). That is safe: the API already settles over-age
    pending rows, and only one background job can own a row.
    """
    if not _IS_SQLITE:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE reports
                   SET status = 'failed',
                       error = 'Superseded: a duplicate pending report was settled on upgrade',
                       finished_at = CURRENT_TIMESTAMP
                 WHERE status = 'pending'
                   AND id NOT IN (
                       SELECT MAX(id) FROM reports WHERE status = 'pending' GROUP BY assessment_id
                   )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_one_pending_per_assessment
                    ON reports (assessment_id) WHERE status = 'pending'
                """
            )
        )


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
