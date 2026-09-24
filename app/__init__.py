from flask import Flask, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
import os

db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()

def create_app(config_overrides=None):
    # Load .env variables
    load_dotenv()

    app = Flask(__name__)

    # Load config from config.py
    app.config.from_object('config.Config')
    if config_overrides:
        app.config.update(config_overrides)

    # Make sure the folder for the SQLite database exists
    db_uri = app.config['SQLALCHEMY_DATABASE_URI']
    if db_uri.startswith('sqlite:///'):
        db_dir = os.path.dirname(db_uri[len('sqlite:///'):])
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    # Import and register blueprints
    from app.routes import auth_bp
    from app.task_routes import task_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(task_bp)

    # Return JSON (not HTML) for common HTTP errors
    for code in (400, 404, 405, 415, 500):
        app.register_error_handler(code, _json_error)

    # Create tables if they don't exist yet (migrations aren't committed)
    with app.app_context():
        from app import models  # noqa: F401
        db.create_all()

    return app


def _json_error(error):
    code = getattr(error, 'code', 500) or 500
    name = getattr(error, 'name', 'Internal Server Error')
    return jsonify({'error': name}), code
