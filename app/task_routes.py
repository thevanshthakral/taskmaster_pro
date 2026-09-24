from datetime import date

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required, current_user
from sqlalchemy import case, func, or_
from app.models import Task
from app.routes import get_json_body
from app import db

task_bp = Blueprint('tasks', __name__)

PRIORITY_RANK = case(
    (Task.priority == 'high', 3),
    (Task.priority == 'low', 1),
    else_=2,
)

SORT_COLUMNS = {
    'created_at': Task.created_at,
    'updated_at': Task.updated_at,
    'due_date': Task.due_date,
    'priority': PRIORITY_RANK,
    'title': func.lower(Task.title),
}


def parse_date(value):
    """Parse an ISO date (YYYY-MM-DD). Returns (date, error)."""
    if value is None or value == '':
        return None, None
    if not isinstance(value, str):
        return None, 'Dates must be strings in YYYY-MM-DD format'
    try:
        return date.fromisoformat(value), None
    except ValueError:
        return None, 'Dates must be in YYYY-MM-DD format'


def parse_bool(value):
    return str(value).lower() in ('1', 'true', 'yes')


def validate_task_fields(data, partial):
    """Validate the task payload. Returns an error message or None."""
    if not partial or 'title' in data:
        title = data.get('title')
        if not isinstance(title, str) or not title.strip():
            return 'Title is required'
        if len(title.strip()) > 150:
            return 'Title must be at most 150 characters'

    if 'description' in data and data['description'] is not None \
            and not isinstance(data['description'], str):
        return 'Description must be a string'

    if 'status' in data and data['status'] not in Task.VALID_STATUSES:
        return f"Status must be one of: {', '.join(Task.VALID_STATUSES)}"

    if 'priority' in data and data['priority'] not in Task.VALID_PRIORITIES:
        return f"Priority must be one of: {', '.join(Task.VALID_PRIORITIES)}"

    if 'due_date' in data:
        _, error = parse_date(data['due_date'])
        if error:
            return error

    return None


def apply_task_fields(task, data):
    if 'title' in data:
        task.title = data['title'].strip()
    if 'description' in data:
        task.description = data['description'] or ''
    if 'status' in data:
        task.status = data['status']
    if 'priority' in data:
        task.priority = data['priority']
    if 'due_date' in data:
        task.due_date, _ = parse_date(data['due_date'])


def user_tasks():
    return Task.query.filter_by(user_id=current_user.id)


def get_user_task(task_id):
    return user_tasks().filter_by(id=task_id).first()


def split_values(value):
    return [v.strip() for v in value.split(',') if v.strip()]


# Create a new task
@task_bp.route('/tasks', methods=['POST'])
@jwt_required()
def create_task():
    data = get_json_body()
    if data is None:
        return jsonify({'error': 'Request body must be a JSON object'}), 400

    error = validate_task_fields(data, partial=False)
    if error:
        return jsonify({'error': error}), 400

    task = Task(user_id=current_user.id, description='', status='pending', priority='medium')
    apply_task_fields(task, data)
    db.session.add(task)
    db.session.commit()

    return jsonify(task.to_dict()), 201


# Get tasks for the user, with filtering, search, sorting and pagination.
# The body stays a plain list; pagination info is returned in X-* headers.
@task_bp.route('/tasks', methods=['GET'])
@jwt_required()
def get_tasks():
    args = request.args
    query = user_tasks()

    if 'status' in args:
        statuses = split_values(args['status'])
        invalid = [s for s in statuses if s not in Task.VALID_STATUSES]
        if invalid or not statuses:
            return jsonify({'error': f"Status must be one of: {', '.join(Task.VALID_STATUSES)}"}), 400
        query = query.filter(Task.status.in_(statuses))

    if 'priority' in args:
        priorities = split_values(args['priority'])
        invalid = [p for p in priorities if p not in Task.VALID_PRIORITIES]
        if invalid or not priorities:
            return jsonify({'error': f"Priority must be one of: {', '.join(Task.VALID_PRIORITIES)}"}), 400
        query = query.filter(Task.priority.in_(priorities))

    search = args.get('q', '').strip()
    if search:
        query = query.filter(or_(
            Task.title.icontains(search, autoescape=True),
            Task.description.icontains(search, autoescape=True),
        ))

    for param, op in (('due_before', '__le__'), ('due_after', '__ge__')):
        if param in args:
            value, error = parse_date(args[param])
            if error or value is None:
                return jsonify({'error': f'{param} must be in YYYY-MM-DD format'}), 400
            query = query.filter(getattr(Task.due_date, op)(value))

    if parse_bool(args.get('overdue', '')):
        query = query.filter(Task.due_date < date.today(), Task.status != 'completed')

    sort = args.get('sort', 'created_at')
    if sort not in SORT_COLUMNS:
        return jsonify({'error': f"sort must be one of: {', '.join(SORT_COLUMNS)}"}), 400
    order = args.get('order', 'asc').lower()
    if order not in ('asc', 'desc'):
        return jsonify({'error': "order must be 'asc' or 'desc'"}), 400
    column = SORT_COLUMNS[sort]
    # Tasks without a due date always go last when sorting by due date
    ordering = [Task.due_date.is_(None)] if sort == 'due_date' else []
    ordering.append(column.desc() if order == 'desc' else column.asc())
    ordering.append(Task.id)
    query = query.order_by(*ordering)

    try:
        page = int(args.get('page', 1))
        per_page = int(args.get('per_page', current_app.config['TASKS_PER_PAGE']))
    except ValueError:
        return jsonify({'error': 'page and per_page must be integers'}), 400
    if page < 1 or per_page < 1:
        return jsonify({'error': 'page and per_page must be positive'}), 400
    per_page = min(per_page, current_app.config['TASKS_MAX_PER_PAGE'])

    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    response = jsonify([task.to_dict() for task in pagination.items])
    response.headers['X-Total-Count'] = str(pagination.total)
    response.headers['X-Page'] = str(page)
    response.headers['X-Per-Page'] = str(per_page)
    response.headers['X-Total-Pages'] = str(pagination.pages)
    return response, 200


# Summary counts for the user's tasks
@task_bp.route('/tasks/stats', methods=['GET'])
@jwt_required()
def task_stats():
    by_status = dict(
        user_tasks().with_entities(Task.status, func.count(Task.id)).group_by(Task.status).all()
    )
    by_priority = dict(
        user_tasks().with_entities(func.coalesce(Task.priority, 'medium'), func.count(Task.id))
        .group_by(func.coalesce(Task.priority, 'medium')).all()
    )
    overdue = user_tasks().filter(Task.due_date < date.today(), Task.status != 'completed').count()
    total = sum(by_status.values())

    return jsonify({
        'total': total,
        'by_status': {s: by_status.get(s, 0) for s in Task.VALID_STATUSES},
        'by_priority': {p: by_priority.get(p, 0) for p in Task.VALID_PRIORITIES},
        'overdue': overdue,
        'completion_rate': round(by_status.get('completed', 0) / total, 4) if total else 0.0,
    }), 200


# Delete all of the user's completed tasks
@task_bp.route('/tasks/completed', methods=['DELETE'])
@jwt_required()
def delete_completed_tasks():
    deleted = user_tasks().filter_by(status='completed').delete(synchronize_session=False)
    db.session.commit()
    return jsonify({'message': f'Deleted {deleted} completed task(s)', 'deleted': deleted}), 200


# Get a single task
@task_bp.route('/tasks/<int:id>', methods=['GET'])
@jwt_required()
def get_task(id):
    task = get_user_task(id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    return jsonify(task.to_dict()), 200


# Update a task (PUT and PATCH both accept partial updates)
@task_bp.route('/tasks/<int:id>', methods=['PUT', 'PATCH'])
@jwt_required()
def update_task(id):
    task = get_user_task(id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404

    data = get_json_body()
    if data is None:
        return jsonify({'error': 'Request body must be a JSON object'}), 400

    error = validate_task_fields(data, partial=True)
    if error:
        return jsonify({'error': error}), 400

    apply_task_fields(task, data)
    db.session.commit()

    return jsonify(task.to_dict()), 200


# Delete a task
@task_bp.route('/tasks/<int:id>', methods=['DELETE'])
@jwt_required()
def delete_task(id):
    task = get_user_task(id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404

    db.session.delete(task)
    db.session.commit()

    return jsonify({'message': 'Task deleted successfully'}), 200
