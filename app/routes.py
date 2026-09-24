from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy.exc import IntegrityError
from app.models import User
from app import db
from flask_jwt_extended import (
    create_access_token, create_refresh_token, current_user, jwt_required,
)

auth_bp = Blueprint('auth', __name__)


def get_json_body():
    """Return the request's JSON object, or None if it is missing or not an object."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def clean_str(value):
    return value.strip() if isinstance(value, str) else None


def validate_password(password):
    if len(password) < 6:
        return "Password must be at least 6 characters"
    return None


@auth_bp.route('/register', methods=['POST'])
def register():
    data = get_json_body()
    if data is None:
        return jsonify({"error": "Request body must be a JSON object"}), 400

    username = clean_str(data.get('username'))
    email = clean_str(data.get('email'))
    password = data.get('password')
    if not isinstance(password, str):
        password = None

    if not all([username, email, password]):
        return jsonify({"error": "All fields are required"}), 400

    email = email.lower()

    if len(username) > 80:
        return jsonify({"error": "Username must be at most 80 characters"}), 400

    if len(email) > 120 or '@' not in email:
        return jsonify({"error": "Invalid email address"}), 400

    password_error = validate_password(password)
    if password_error:
        return jsonify({"error": password_error}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({"error": "Username already exists"}), 409

    if User.query.filter_by(email=email).first():
        return jsonify({"error": "Email already exists"}), 409

    hashed_password = generate_password_hash(password)
    new_user = User(username=username, email=email, password=hashed_password)
    db.session.add(new_user)
    try:
        db.session.commit()
    except IntegrityError:
        # Another request registered the same username/email concurrently
        db.session.rollback()
        return jsonify({"error": "Username or email already exists"}), 409

    return jsonify({"message": "User registered successfully"}), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    data = get_json_body()
    if data is None:
        return jsonify({"error": "Request body must be a JSON object"}), 400

    email = clean_str(data.get('email'))
    password = data.get('password')
    if not isinstance(password, str):
        password = None

    if not all([email, password]):
        return jsonify({"error": "Email and password are required"}), 400

    user = User.query.filter_by(email=email.lower()).first()
    if not user or not check_password_hash(user.password, password):
        return jsonify({"error": "Invalid credentials"}), 401

    # JWT subject ("sub") must be a string
    identity = str(user.id)
    return jsonify({
        "access_token": create_access_token(identity=identity),
        "refresh_token": create_refresh_token(identity=identity),
    }), 200


@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    # Exchange a refresh token for a new access token
    return jsonify({"access_token": create_access_token(identity=str(current_user.id))}), 200


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_me():
    user = current_user
    return jsonify(user.to_dict()), 200


@auth_bp.route('/me/password', methods=['PUT'])
@jwt_required()
def change_password():
    user = current_user

    data = get_json_body()
    if data is None:
        return jsonify({"error": "Request body must be a JSON object"}), 400

    current_password = data.get('current_password')
    new_password = data.get('new_password')
    if not isinstance(current_password, str) or not isinstance(new_password, str) \
            or not current_password or not new_password:
        return jsonify({"error": "current_password and new_password are required"}), 400

    if not check_password_hash(user.password, current_password):
        return jsonify({"error": "Current password is incorrect"}), 401

    password_error = validate_password(new_password)
    if password_error:
        return jsonify({"error": password_error}), 400

    user.password = generate_password_hash(new_password)
    db.session.commit()
    return jsonify({"message": "Password updated successfully"}), 200


@auth_bp.route('/me', methods=['DELETE'])
@jwt_required()
def delete_me():
    user = current_user

    # Deleting the user also deletes their tasks (cascade on the relationship)
    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "Account deleted successfully"}), 200
