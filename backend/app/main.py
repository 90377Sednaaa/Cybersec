"""FastAPI application factory: CORS, routers, table creation, admin seeding."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api import assessments, auth, evidence, findings, misc, reports, settings_llm, targets, users
from app.config import settings
from app.core.security import hash_password
from app.database import Base, SessionLocal, engine, ensure_sqlite_columns
from app.models import Role, User  # noqa: F401  (import registers all models)

logger = logging.getLogger("platform")


def seed_admin() -> None:
    with SessionLocal() as db:
        if db.scalar(select(User).limit(1)) is not None:
            return
        db.add(
            User(
                email=settings.admin_email,
                full_name=settings.admin_name,
                role=Role.admin,
                hashed_password=hash_password(settings.admin_password),
            )
        )
        db.commit()
        logger.warning(
            "Seeded bootstrap admin %s with a default password - change it via the users API.",
            settings.admin_email,
        )


def create_app() -> FastAPI:
    Base.metadata.create_all(bind=engine)
    ensure_sqlite_columns()
    seed_admin()
    # Seeded once here, not on every settings GET (a viewer read must not write).
    settings_llm.ensure_task_configs()

    app = FastAPI(
        title="AI-Assisted Security Assessment Platform",
        version="0.1.0",
        description="Final project - combines existing security tools with AI analysis, "
        "keeping a human assessor in charge of confirmed findings.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(misc.router)
    app.include_router(auth.router, prefix="/api")
    app.include_router(users.router, prefix="/api")
    app.include_router(targets.router, prefix="/api")
    app.include_router(assessments.router, prefix="/api")
    app.include_router(findings.router, prefix="/api")
    app.include_router(evidence.router, prefix="/api")  # M4 T4.2 (steward: merge as routine)
    app.include_router(settings_llm.router, prefix="/api")  # M2 T2.2 (steward: merge as routine)
    app.include_router(reports.router, prefix="/api")  # M4 T4.4 (steward: merge as routine)
    return app


app = create_app()
