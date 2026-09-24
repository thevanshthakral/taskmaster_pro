from conftest import register_and_login


def test_register_and_login_on_fresh_database(client):
    resp = client.post('/register', json={'username': 'bob', 'email': 'Bob@Example.com', 'password': 'secret123'})
    assert resp.status_code == 201

    resp = client.post('/login', json={'email': 'bob@example.com', 'password': 'secret123'})
    assert resp.status_code == 200
    assert 'access_token' in resp.get_json()


def test_register_duplicate(client):
    body = {'username': 'bob', 'email': 'bob@example.com', 'password': 'secret123'}
    assert client.post('/register', json=body).status_code == 201
    assert client.post('/register', json=body).status_code == 409


def test_missing_or_invalid_body_returns_400(client):
    assert client.post('/register').status_code in (400, 415)
    assert client.post('/register', data='not json', content_type='application/json').status_code == 400
    assert client.post('/login', json=['a', 'list']).status_code == 400
    assert client.post('/register', json={'username': 1, 'email': 'x@y.z', 'password': 'secret123'}).status_code == 400


def test_bad_login(client):
    register_and_login(client)
    resp = client.post('/login', json={'email': 'alice@example.com', 'password': 'wrong'})
    assert resp.status_code == 401


def test_task_crud(client):
    headers = register_and_login(client)

    resp = client.post('/tasks', json={'title': 'Write tests'}, headers=headers)
    assert resp.status_code == 201
    task = resp.get_json()
    assert task['status'] == 'pending'

    resp = client.get(f"/tasks/{task['id']}", headers=headers)
    assert resp.status_code == 200

    resp = client.put(f"/tasks/{task['id']}", json={'status': 'completed'}, headers=headers)
    assert resp.status_code == 200
    assert resp.get_json()['status'] == 'completed'
    assert resp.get_json()['title'] == 'Write tests'

    assert len(client.get('/tasks', headers=headers).get_json()) == 1

    assert client.delete(f"/tasks/{task['id']}", headers=headers).status_code == 200
    assert client.get('/tasks', headers=headers).get_json() == []


def test_task_validation(client):
    headers = register_and_login(client)
    assert client.post('/tasks', json={}, headers=headers).status_code == 400
    assert client.post('/tasks', json={'title': '   '}, headers=headers).status_code == 400
    assert client.post('/tasks', json={'title': 'x', 'status': 'bogus'}, headers=headers).status_code == 400

    task_id = client.post('/tasks', json={'title': 'x'}, headers=headers).get_json()['id']
    assert client.put(f'/tasks/{task_id}', json={'title': ''}, headers=headers).status_code == 400
    assert client.put(f'/tasks/{task_id}', json={'status': 'done?'}, headers=headers).status_code == 400
    assert client.put(f'/tasks/{task_id}', data='oops', content_type='application/json',
                      headers=headers).status_code == 400


def test_tasks_are_isolated_per_user(client):
    alice = register_and_login(client)
    bob = register_and_login(client, 'bob', 'bob@example.com')

    task_id = client.post('/tasks', json={'title': 'private'}, headers=alice).get_json()['id']

    assert client.get('/tasks', headers=bob).get_json() == []
    assert client.get(f'/tasks/{task_id}', headers=bob).status_code == 404
    assert client.put(f'/tasks/{task_id}', json={'title': 'hacked'}, headers=bob).status_code == 404
    assert client.delete(f'/tasks/{task_id}', headers=bob).status_code == 404


def test_tasks_require_auth(client):
    assert client.get('/tasks').status_code == 401


def test_unknown_route_returns_json(client):
    resp = client.get('/nope')
    assert resp.status_code == 404
    assert resp.is_json
