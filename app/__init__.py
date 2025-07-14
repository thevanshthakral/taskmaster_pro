from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
import os

db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()

def create_app():
    # Load .env variables
    load_dotenv()

    app = Flask(__name__)

    # Load config from config.py
    app.config.from_object('config.Config')

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    # Import and register blueprints
    from app.routes import auth_bp
    from app.task_routes import task_bp   # ✅ this was missing

    app.register_blueprint(auth_bp)
    app.register_blueprint(task_bp)       # ✅ this will fix 404

    return app
