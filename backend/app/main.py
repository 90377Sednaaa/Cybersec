"""FastAPI application factory: CORS, routers, table creation, admin seeding."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api import assessments, auth, findings, misc, targets, users
from app.config import settings
from app.core.security import hash_password
from app.database import Base, SessionLocal, engine
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
    seed_admin()

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
    return app


app = create_app()
