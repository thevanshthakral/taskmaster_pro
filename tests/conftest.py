import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import create_app, db  # noqa: E402


@pytest.fixture
def app(tmp_path):
    app = create_app({
        'TESTING': True,
        'SQLALCHEMY_DATABASE_URI': 'sqlite:///' + str(tmp_path / 'instance' / 'test.db'),
    })
    yield app
    with app.app_context():
        db.session.remove()
        db.drop_all()
        db.engine.dispose()


@pytest.fixture
def client(app):
    return app.test_client()


def register_and_login(client, username='alice', email='alice@example.com', password='secret123'):
    client.post('/register', json={'username': username, 'email': email, 'password': password})
    resp = client.post('/login', json={'email': email, 'password': password})
    return {'Authorization': f"Bearer {resp.get_json()['access_token']}"}
