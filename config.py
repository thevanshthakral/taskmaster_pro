import os

# Get absolute path of the current file's directory
basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
    # Load secret keys from environment or fallback (used by Flask & JWT)
    SECRET_KEY = os.getenv('SECRET_KEY', 'supersecret')
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'superjwtkey')  # 🔐 Important for Flask-JWT-Extended

    # Database path (inside the instance folder)
    SQLALCHEMY_DATABASE_URI = 'sqlite:///' + os.path.join(basedir, 'instance', 'taskmaster.db')

    # Disable unnecessary overhead
    SQLALCHEMY_TRACK_MODIFICATIONS = False
