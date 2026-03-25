"""Initial tables: users, monuments, obits

Revision ID: 001_initial
Revises: 
Create Date: 2026-03-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Users
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('email', sa.String(320), nullable=False),
        sa.Column('hashed_password', sa.String(128), nullable=False),
        sa.Column('full_name', sa.String(256), nullable=False),
        sa.Column('is_admin', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)

    # Monuments
    op.create_table(
        'monuments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('cemetery_name', sa.String(512), nullable=False),
        sa.Column('deceased_name', sa.String(512), nullable=True),
        sa.Column('date_of_birth', sa.String(64), nullable=True),
        sa.Column('date_of_death', sa.String(64), nullable=True),
        sa.Column('notes', sa.Text(), nullable=False, server_default=''),
        sa.Column('photo_url', sa.String(1024), nullable=True),
        sa.Column('ocr_raw_text', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_monuments_cemetery_name', 'monuments', ['cemetery_name'])
    op.create_index('ix_monuments_user_id', 'monuments', ['user_id'])

    # Obits
    op.create_table(
        'obits',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('deceased_name', sa.String(512), nullable=False),
        sa.Column('date_of_death', sa.String(64), nullable=True),
        sa.Column('newspaper', sa.String(512), nullable=False, server_default=''),
        sa.Column('monument_ordered', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('notes', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_obits_user_id', 'obits', ['user_id'])


def downgrade() -> None:
    op.drop_table('obits')
    op.drop_table('monuments')
    op.drop_table('users')
