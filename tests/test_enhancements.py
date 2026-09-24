from datetime import date, timedelta

from conftest import register_and_login


def make(client, headers, **fields):
    resp = client.post('/tasks', json=fields, headers=headers)
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def ids(resp):
    return [t['title'] for t in resp.get_json()]


def test_priority_and_due_date(client):
    headers = register_and_login(client)
    task = make(client, headers, title='a', priority='high', due_date='2030-01-15')
    assert task['priority'] == 'high'
    assert task['due_date'] == '2030-01-15'
    assert task['is_overdue'] is False
    assert task['updated_at']

    assert make(client, headers, title='b')['priority'] == 'medium'
    assert client.post('/tasks', json={'title': 'x', 'priority': 'urgent'}, headers=headers).status_code == 400
    assert client.post('/tasks', json={'title': 'x', 'due_date': '15/01/2030'}, headers=headers).status_code == 400

    resp = client.patch(f"/tasks/{task['id']}", json={'due_date': None}, headers=headers)
    assert resp.status_code == 200
    assert resp.get_json()['due_date'] is None


def test_overdue(client):
    headers = register_and_login(client)
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    late = make(client, headers, title='late', due_date=yesterday)
    make(client, headers, title='done late', due_date=yesterday, status='completed')
    make(client, headers, title='future', due_date='2099-01-01')

    assert late['is_overdue'] is True
    assert ids(client.get('/tasks?overdue=true', headers=headers)) == ['late']


def test_filter_search_sort(client):
    headers = register_and_login(client)
    make(client, headers, title='Buy milk', priority='low', due_date='2030-03-01')
    make(client, headers, title='Write report', description='quarterly numbers', priority='high',
         status='in_progress')
    make(client, headers, title='call mom', priority='medium', due_date='2030-01-01', status='completed')

    assert ids(client.get('/tasks?status=completed', headers=headers)) == ['call mom']
    assert ids(client.get('/tasks?status=pending,in_progress', headers=headers)) == ['Buy milk', 'Write report']
    assert ids(client.get('/tasks?priority=high', headers=headers)) == ['Write report']
    assert ids(client.get('/tasks?q=QUARTERLY', headers=headers)) == ['Write report']
    assert ids(client.get('/tasks?q=%25', headers=headers)) == []  # LIKE wildcards are escaped
    assert ids(client.get('/tasks?sort=priority&order=desc', headers=headers)) == \
        ['Write report', 'call mom', 'Buy milk']
    assert ids(client.get('/tasks?sort=title', headers=headers)) == ['Buy milk', 'call mom', 'Write report']
    # Tasks without a due date go last
    assert ids(client.get('/tasks?sort=due_date', headers=headers)) == ['call mom', 'Buy milk', 'Write report']
    assert ids(client.get('/tasks?due_before=2030-02-01', headers=headers)) == ['call mom']

    for bad in ('status=nope', 'priority=nope', 'sort=nope', 'order=up', 'due_after=soon', 'page=0', 'per_page=x'):
        assert client.get(f'/tasks?{bad}', headers=headers).status_code == 400, bad


def test_pagination(client, app):
    headers = register_and_login(client)
    for i in range(5):
        make(client, headers, title=f't{i}')

    resp = client.get('/tasks?page=2&per_page=2', headers=headers)
    assert ids(resp) == ['t2', 't3']
    assert resp.headers['X-Total-Count'] == '5'
    assert resp.headers['X-Total-Pages'] == '3'
    assert ids(client.get('/tasks?page=9&per_page=2', headers=headers)) == []

    resp = client.get('/tasks?per_page=100000', headers=headers)
    assert resp.headers['X-Per-Page'] == str(app.config['TASKS_MAX_PER_PAGE'])


def test_stats_and_clear_completed(client):
    headers = register_and_login(client)
    make(client, headers, title='a', status='completed', priority='high')
    make(client, headers, title='b', status='completed')
    make(client, headers, title='c', due_date='2000-01-01')
    make(client, headers, title='d', status='in_progress', priority='low')

    stats = client.get('/tasks/stats', headers=headers).get_json()
    assert stats == {
        'total': 4,
        'by_status': {'pending': 1, 'in_progress': 1, 'completed': 2},
        'by_priority': {'low': 1, 'medium': 2, 'high': 1},
        'overdue': 1,
        'completion_rate': 0.5,
    }

    other = register_and_login(client, 'bob', 'bob@example.com')
    make(client, other, title='bob done', status='completed')

    resp = client.delete('/tasks/completed', headers=headers)
    assert resp.get_json()['deleted'] == 2
    assert ids(client.get('/tasks', headers=headers)) == ['c', 'd']
    assert ids(client.get('/tasks', headers=other)) == ['bob done']


def test_refresh_token(client):
    client.post('/register', json={'username': 'a', 'email': 'a@example.com', 'password': 'secret123'})
    tokens = client.post('/login', json={'email': 'a@example.com', 'password': 'secret123'}).get_json()

    resp = client.post('/refresh', headers={'Authorization': f"Bearer {tokens['refresh_token']}"})
    assert resp.status_code == 200
    new_access = resp.get_json()['access_token']
    assert client.get('/tasks', headers={'Authorization': f'Bearer {new_access}'}).status_code == 200

    # An access token can't be used to refresh, and a refresh token can't access tasks
    assert client.post('/refresh', headers={'Authorization': f"Bearer {tokens['access_token']}"}).status_code == 422
    assert client.get('/tasks', headers={'Authorization': f"Bearer {tokens['refresh_token']}"}).status_code == 422


def test_profile_password_and_account_deletion(client):
    headers = register_and_login(client)
    me = client.get('/me', headers=headers).get_json()
    assert me['username'] == 'alice' and me['email'] == 'alice@example.com'
    assert 'password' not in me

    bad = client.put('/me/password', json={'current_password': 'wrong', 'new_password': 'newpass1'}, headers=headers)
    assert bad.status_code == 401
    short = client.put('/me/password', json={'current_password': 'secret123', 'new_password': 'x'}, headers=headers)
    assert short.status_code == 400
    ok = client.put('/me/password', json={'current_password': 'secret123', 'new_password': 'newpass1'},
                    headers=headers)
    assert ok.status_code == 200
    assert client.post('/login', json={'email': 'alice@example.com', 'password': 'secret123'}).status_code == 401
    assert client.post('/login', json={'email': 'alice@example.com', 'password': 'newpass1'}).status_code == 200

    make(client, headers, title='will be removed')
    assert client.delete('/me', headers=headers).status_code == 200
    # Tokens for a deleted account stop working
    assert client.get('/tasks', headers=headers).status_code == 401
    assert client.post('/login', json={'email': 'alice@example.com', 'password': 'newpass1'}).status_code == 401


def test_health(client):
    assert client.get('/health').get_json() == {'status': 'ok'}
