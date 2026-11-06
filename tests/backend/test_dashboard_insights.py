"""Exercise dashboard aggregate routes against synthetic SQLite records."""
import ast
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace as S
import unittest

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, relationship, Session

Base = declarative_base()


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail


class Intake(Base):
    __tablename__ = "dashboard_intake"
    intake_id = Column(Integer, primary_key=True)
    form_date = Column(DateTime)
    nature_of_case = Column(String)


class Case(Base):
    __tablename__ = "dashboard_case"
    case_id = Column(Integer, primary_key=True)
    intake_id = Column(Integer, ForeignKey("dashboard_intake.intake_id"))
    case_type = Column(String)
    is_terminated = Column(Boolean, default=False)
    status_of_case = Column(String)
    last_updated = Column(DateTime)
    incident_barangay = Column(String)
    cause_of_action = Column(String)
    intake = relationship(Intake)


class Submission(Base):
    __tablename__ = "dashboard_submission"
    submission_id = Column(Integer, primary_key=True)
    status = Column(String)


class DashboardInsightTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        now = datetime.now().replace(day=2, hour=12, minute=0, second=0, microsecond=0)
        self.db.add_all([
            Intake(intake_id=1, form_date=now, nature_of_case="Theft"),
            Case(case_id=1, intake_id=1, case_type="Criminal", is_terminated=False,
                 status_of_case="Pending", last_updated=now, incident_barangay="A", cause_of_action="Theft"),
            Case(case_id=2, case_type="Civil", is_terminated=True, status_of_case="Terminated",
                 last_updated=now - timedelta(days=40), incident_barangay="B", cause_of_action="Land dispute"),
            Case(case_id=3, case_type="Criminal", is_terminated=False, status_of_case="Active",
                 last_updated=None, incident_barangay=None, cause_of_action=None),
            Submission(submission_id=1, status="Submitted"),
            Submission(submission_id=2, status="Under Review"),
            Submission(submission_id=3, status="Approved"),
        ])
        self.db.commit()
        def is_terminated(record):
            return bool(record.is_terminated or (record.status_of_case or "").lower() == "terminated")
        def case_category(record):
            return record.intake.nature_of_case if record.intake and record.intake.nature_of_case else record.cause_of_action or "Uncategorized"
        def case_barangay(record):
            return record.incident_barangay or "Unspecified"
        def build_barangay_stats(records):
            return [
                {"barangay": "A", "city": "Panabo City", "total_cases": 1, "active_cases": 1,
                 "terminated_cases": 0, "most_common_category": "Theft", "latitude": 7.3, "longitude": 125.6},
                {"barangay": "Unmapped", "city": "", "total_cases": 1, "active_cases": 1,
                 "terminated_cases": 0, "most_common_category": "Other", "latitude": None, "longitude": None},
            ]
        namespace = {
            "models": S(Case=Case, IntakeRecord=Intake, CaseSubmission=Submission),
            "datetime": datetime,
            "Depends": lambda value: None,
            "HTTPException": HTTPException,
            "current_user": None,
            "get_db": None,
            "is_admin": lambda user: user.role.role_name.lower() == "admin",
            "is_case_terminated": is_terminated,
            "case_category": case_category,
            "case_barangay": case_barangay,
            "build_barangay_stats": build_barangay_stats,
            "PANABO_CENTER": {"lat": 7.3, "lng": 125.6},
        }
        source = Path(__file__).resolve().parents[2] / "backend/main.py"
        module = ast.parse(source.read_text(encoding="utf-8"))
        names = {"ensure_dashboard_insights_access", "dashboard_intelligence_brief", "dashboard_office_hotspots"}
        nodes = [node for node in module.body if isinstance(node, ast.FunctionDef) and node.name in names]
        for node in nodes:
            node.decorator_list = []
            node.returns = None
            for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
                arg.annotation = None
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "<dashboard insight routes>", "exec"), namespace)
        self.routes = namespace

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_intelligence_brief_aggregates_cases_without_exposing_records(self):
        result = self.routes["dashboard_intelligence_brief"](S(role=S(role_name="Staff")), self.db)
        self.assertEqual(result["total_cases"], 3)
        self.assertEqual(result["active_cases"], 2)
        self.assertEqual(result["criminal_cases"], 2)
        self.assertEqual(result["civil_cases"], 1)
        self.assertEqual(result["cases_this_month"], 1)
        self.assertEqual(result["pending_reviews"], 2)
        self.assertNotIn("client_name", result)
        self.assertNotIn("case_title", result)

    def test_intelligence_brief_denies_roles_outside_admin_and_staff(self):
        with self.assertRaises(HTTPException) as error:
            self.routes["dashboard_intelligence_brief"](S(role=S(role_name="Reviewer")), self.db)
        self.assertEqual(error.exception.status_code, 403)

    def test_office_hotspots_returns_aggregate_mapped_barangays_only(self):
        result = self.routes["dashboard_office_hotspots"](S(role=S(role_name="Staff")), self.db)
        self.assertEqual(result["center"], {"lat": 7.3, "lng": 125.6})
        self.assertEqual(result["points"], [])
        self.assertEqual([row["barangay"] for row in result["barangays"]], ["A"])
        self.assertNotIn("client_name", result["barangays"][0])


if __name__ == "__main__":
    unittest.main()
