import os

from app import create_app

app = create_app()

if __name__ == "__main__":
    # Debug mode is opt-in: set FLASK_DEBUG=1 to enable it
    app.run(debug=os.getenv('FLASK_DEBUG', '0').lower() in ('1', 'true', 'yes'))
