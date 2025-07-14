from app import db
from datetime import datetime

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False, unique=True)
    email = db.Column(db.String(120), nullable=False, unique=True)
    password = db.Column(db.String(200), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # ✅ Relationship to Task model (one-to-many)
    tasks = db.relationship('Task', backref='user', lazy=True, cascade="all, delete")

    def __repr__(self):
        return f'<User {self.username}>'

# ✅ Optional: Create your Task model here or in another file
class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(20), default='pending')  # e.g., pending, completed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # ✅ Foreign key to User
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    def __repr__(self):
        return f'<Task {self.title}>'
