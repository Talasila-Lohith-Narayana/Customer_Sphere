from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.dialects.mysql import CHAR

# Base declarative class for all ORM models
Base = declarative_base()


class AppUser(Base):
    """
    User account model for authentication and role-based access control (RBAC).
    Supported roles: 'admin' (full read/write/delete), 'viewer' (read-only).
    """
    __tablename__ = "ci_users"
    id = Column(Integer, primary_key=True)
    username = Column(String(80), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="viewer")
    access_pages = Column(Text, nullable=True)
    token_version = Column(Integer, nullable=False, default=0, server_default="0")


class ConsumerInteraction(Base):
    """
    CRM interaction logs recorded by team members against a specific customer.
    Includes interaction type (Call, Email, Note, Support, Follow-up), title, and description.
    """
    __tablename__ = "consumer_interactions"
    id = Column(Integer, primary_key=True)
    customer_id = Column(CHAR(32), nullable=False, index=True)
    interaction_type = Column(String(50), nullable=False)
    title = Column(String(120), nullable=False)
    description = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False)


class AuditLog(Base):
    """
    Immutable audit logging table tracking operational actions (e.g. customer creation,
    edits, deletions, notes) performed by users for governance and traceability.
    """
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    customer_id = Column(CHAR(32), nullable=False, index=True)
    action = Column(String(50), nullable=False)
    performed_by = Column(String(80), nullable=False)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False)
