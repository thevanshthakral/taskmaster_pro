# TaskMaster Pro

A small Flask REST API for managing personal tasks, with JWT authentication.

## Setup

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python run.py            # FLASK_DEBUG=1 python run.py for debug mode
```

Then open http://localhost:5000/ in your browser. The SQLite database is
created automatically at `instance/taskmaster.db`.

## Frontend

A single-page web app is served at `/` from `app/static/` (plain HTML, CSS and
JavaScript, no build step). It covers everything the API offers:

- Sign in / create an account; the session is kept in `localStorage` and the
  access token is refreshed automatically with the refresh token.
- Summary cards (totals, overdue, completion rate).
- Task list with search, status/priority filters, overdue toggle, sorting and
  pagination.
- Create, edit, complete and delete tasks (press **N** for a new task), and
  clear all completed tasks.
- Account dialog: profile, change password, delete account.
- Light/dark theme (follows the system, with a toggle) and a mobile layout.

### Configuration (environment variables or `.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `SECRET_KEY` | dev fallback | Flask secret key — **set in production** |
| `JWT_SECRET_KEY` | dev fallback | Signs access/refresh tokens — **set in production** |
| `DATABASE_URL` | `sqlite:///instance/taskmaster.db` | SQLAlchemy database URL |
| `JWT_ACCESS_TOKEN_MINUTES` | `60` | Access token lifetime |
| `JWT_REFRESH_TOKEN_DAYS` | `30` | Refresh token lifetime |
| `FLASK_DEBUG` | `0` | Enable debug mode |

## Running tests

```bash
pip install pytest
pytest
```

## API

All request and response bodies are JSON. Authenticated endpoints need an
`Authorization: Bearer <access_token>` header. Errors look like `{"error": "..."}`.

### Auth & account

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/register` | `{username, email, password}` → 201 |
| `POST` | `/login` | `{email, password}` → `{access_token, refresh_token}` |
| `POST` | `/refresh` | Send the **refresh** token as the bearer → `{access_token}` |
| `GET` | `/me` | Current user's profile |
| `PUT` | `/me/password` | `{current_password, new_password}` |
| `DELETE` | `/me` | Delete the account and all its tasks |
| `GET` | `/health` | Health check (no auth) |

### Tasks

A task looks like:

```json
{
  "id": 1,
  "title": "Write report",
  "description": "",
  "status": "pending",            // pending | in_progress | completed
  "priority": "medium",           // low | medium | high
  "due_date": "2030-01-15",       // YYYY-MM-DD or null
  "is_overdue": false,
  "created_at": "...",
  "updated_at": "..."
}
```

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/tasks` | Create; `title` required, other fields optional |
| `GET` | `/tasks` | List tasks (see query parameters below) |
| `GET` | `/tasks/<id>` | Get one task |
| `PUT` / `PATCH` | `/tasks/<id>` | Update any subset of fields |
| `DELETE` | `/tasks/<id>` | Delete one task |
| `DELETE` | `/tasks/completed` | Delete all completed tasks |
| `GET` | `/tasks/stats` | Counts by status/priority, overdue count, completion rate |

#### `GET /tasks` query parameters

| Parameter | Example | Description |
| --- | --- | --- |
| `status` | `pending,in_progress` | Filter by one or more statuses |
| `priority` | `high` | Filter by one or more priorities |
| `q` | `report` | Case-insensitive search in title and description |
| `due_before` / `due_after` | `2030-01-31` | Due date range (inclusive) |
| `overdue` | `true` | Only unfinished tasks past their due date |
| `sort` | `due_date` | `created_at` (default), `updated_at`, `due_date`, `priority`, `title` |
| `order` | `desc` | `asc` (default) or `desc` |
| `page`, `per_page` | `2`, `50` | Pagination (default 20 per page, max 100) |

The response body is a JSON list. Pagination details are in the
`X-Total-Count`, `X-Page`, `X-Per-Page` and `X-Total-Pages` headers.
