from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy.exc import IntegrityError
from app.models import User
from app import db
from flask_jwt_extended import create_access_token

auth_bp = Blueprint('auth', __name__)


def get_json_body():
    """Return the request's JSON object, or None if it is missing or not an object."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def clean_str(value):
    return value.strip() if isinstance(value, str) else None


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

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

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
    access_token = create_access_token(identity=str(user.id))

    return jsonify({"access_token": access_token}), 200
