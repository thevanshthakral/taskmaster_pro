import os
from datetime import timedelta

# Get absolute path of the current file's directory
basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
    # Load secret keys from environment or fallback (used by Flask & JWT).
    # The fallbacks are for local development only - always set real values in production.
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-only-secret-key-change-me-in-production')
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'dev-only-jwt-secret-key-change-me-in-prod')  # 🔐 Important for Flask-JWT-Extended

    # Database path (inside the instance folder), overridable via DATABASE_URL
    SQLALCHEMY_DATABASE_URI = os.getenv(
        'DATABASE_URL',
        'sqlite:///' + os.path.join(basedir, 'instance', 'taskmaster.db'),
    )

    # Disable unnecessary overhead
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Token lifetimes (in minutes / days), configurable via environment
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=int(os.getenv('JWT_ACCESS_TOKEN_MINUTES', '60')))
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=int(os.getenv('JWT_REFRESH_TOKEN_DAYS', '30')))

    # Pagination defaults for GET /tasks
    TASKS_PER_PAGE = 20
    TASKS_MAX_PER_PAGE = 100
