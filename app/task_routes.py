from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import Task
from app.routes import get_json_body
from app import db

task_bp = Blueprint('tasks', __name__)


def current_user_id():
    # The identity is stored as a string in the token; the DB column is an integer
    return int(get_jwt_identity())


def validate_task_fields(data, partial):
    """Validate title/description/status. Returns an error message or None."""
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

    return None


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

    task = Task(
        title=data['title'].strip(),
        description=data.get('description') or '',
        status=data.get('status', 'pending'),
        user_id=current_user_id(),
    )
    db.session.add(task)
    db.session.commit()

    return jsonify(task.to_dict()), 201


# Get all tasks for the user
@task_bp.route('/tasks', methods=['GET'])
@jwt_required()
def get_tasks():
    tasks = Task.query.filter_by(user_id=current_user_id()).order_by(Task.id).all()
    return jsonify([task.to_dict() for task in tasks]), 200


# Get a single task
@task_bp.route('/tasks/<int:id>', methods=['GET'])
@jwt_required()
def get_task(id):
    task = Task.query.filter_by(id=id, user_id=current_user_id()).first()
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    return jsonify(task.to_dict()), 200


# Update a task
@task_bp.route('/tasks/<int:id>', methods=['PUT'])
@jwt_required()
def update_task(id):
    task = Task.query.filter_by(id=id, user_id=current_user_id()).first()
    if not task:
        return jsonify({'error': 'Task not found'}), 404

    data = get_json_body()
    if data is None:
        return jsonify({'error': 'Request body must be a JSON object'}), 400

    error = validate_task_fields(data, partial=True)
    if error:
        return jsonify({'error': error}), 400

    if 'title' in data:
        task.title = data['title'].strip()
    if 'description' in data:
        task.description = data['description'] or ''
    if 'status' in data:
        task.status = data['status']

    db.session.commit()

    return jsonify(task.to_dict()), 200


# Delete a task
@task_bp.route('/tasks/<int:id>', methods=['DELETE'])
@jwt_required()
def delete_task(id):
    task = Task.query.filter_by(id=id, user_id=current_user_id()).first()
    if not task:
        return jsonify({'error': 'Task not found'}), 404

    db.session.delete(task)
    db.session.commit()

    return jsonify({'message': 'Task deleted successfully'}), 200
