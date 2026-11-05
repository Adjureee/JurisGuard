"""Exercise selected real route functions against a synthetic SQLite database.

AST loading avoids main.py's application-startup database writes.
"""
import ast
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace as S
import unittest
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import declarative_base, Session

Base = declarative_base()


class Client(Base):
    __tablename__ = 'client'
    client_id = Column(Integer, primary_key=True)
    created_at = Column(DateTime)
    owner = Column(Integer)


class Intake(Base):
    __tablename__ = 'intake'
    intake_id = Column(Integer, primary_key=True)
    form_date = Column(DateTime)
    nature_of_case = Column(String)


class Case(Base):
    __tablename__ = 'case'
    case_id = Column(Integer, primary_key=True)
    intake_id = Column(Integer, ForeignKey('intake.intake_id'))
    last_updated = Column(DateTime)
    owner = Column(Integer)


class AnalyticsRangeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add_all([
            Client(client_id=1, owner=1, created_at=datetime(2026, 1, 31, 23, 59)),
            Client(client_id=2, owner=1, created_at=datetime(2026, 2, 1)),
            Client(client_id=3, owner=2, created_at=datetime(2026, 1, 15)),
            Intake(intake_id=1, form_date=datetime(2026, 1, 31, 23, 59), nature_of_case='Criminal'),
            Case(case_id=1, intake_id=1, owner=1),
            Case(case_id=2, owner=1, last_updated=datetime(2026, 1, 15)),
            Case(case_id=3, owner=2, last_updated=datetime(2026, 1, 15)),
            Case(case_id=4, owner=1, last_updated=datetime(2026, 2, 1)),
        ])
        self.db.commit()
        namespace = dict(models=S(Client=Client, Case=Case, IntakeRecord=Intake), Session=Session,
                         datetime=datetime, timedelta=timedelta, func=func,
                         Depends=lambda value: None, Query=lambda value: value,
                         current_user=None, get_db=None,
                         scoped_client_query=lambda db, user: db.query(Client).filter(Client.owner == user),
                         scoped_case_query=lambda db, user: db.query(Case).outerjoin(Intake).filter(Case.owner == user),
                         parse_date=lambda value: datetime.fromisoformat(value) if value else None)
        module = ast.parse((Path(__file__).resolve().parents[2] / 'backend/main.py').read_text(encoding='utf-8'))
        names = {'case_date_column', 'apply_case_date_filters', 'analytics_client_query', 'dashboard_case_categories'}
        nodes = [node for node in module.body if isinstance(node, ast.FunctionDef) and node.name in names]
        for node in nodes:
            node.decorator_list = []
            node.returns = None
            for arg in node.args.args:
                arg.annotation = None
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<analytics routes>', 'exec'), namespace)
        self.routes = namespace

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_client_date_range_inclusive_end_and_permission_scope(self):
        query = self.routes['analytics_client_query'](self.db, 1, '2026-01-01', '2026-01-31')
        self.assertEqual([row.client_id for row in query], [1])

    def test_categories_filter_same_case_cohort_without_double_counting_missing_intake(self):
        rows = self.routes['dashboard_case_categories'](1, self.db, '2026-01-01', '2026-01-31')
        self.assertEqual({row['category']: row['total_cases'] for row in rows}, {'Criminal': 1, 'Uncategorized': 1})
        self.assertEqual(sum(row['total_cases'] for row in rows), 2)


if __name__ == '__main__':
    unittest.main()
