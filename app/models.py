from app import db
from datetime import datetime, timezone


def utcnow():
    return datetime.now(timezone.utc)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False, unique=True)
    email = db.Column(db.String(120), nullable=False, unique=True)
    password = db.Column(db.String(256), nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow)

    # Relationship to Task model (one-to-many)
    tasks = db.relationship('Task', backref='user', lazy=True, cascade="all, delete")

    def __repr__(self):
        return f'<User {self.username}>'


class Task(db.Model):
    VALID_STATUSES = ('pending', 'in_progress', 'completed')

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(20), default='pending', nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow)

    # Foreign key to User
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'description': self.description,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<Task {self.title}>'
