import io
import importlib.util
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from case_import import read_workbook


class CaseImportWorkbookTests(unittest.TestCase):
    def test_html_export_preserves_rowspans_groups_clients_and_skips_total(self):
        html = """<!doctype html><html><body><table>
        <tr><th>CONTROL NUMBER</th><th>CLIENT NAME</th><th>AGE</th><th>ADDRESS</th><th>TITLE OF THE CASE</th><th>STATUS OF THE CASE</th><th>CASE RECEIVED</th></tr>
        <tr><td rowspan="2">PAO-DEMO-087</td><td>Kennet Lico</td><td>21</td><td>Tibungco</td><td rowspan="2">PP vs. Lico</td><td rowspan="2">Pending</td><td rowspan="2">2026-10-02</td></tr>
        <tr><td>Christian Misal</td><td>26</td><td>Tubod</td></tr>
        <tr><td>TOTAL CASES: 1</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
        </table></body></html>"""
        records, processed, source_format = read_workbook(html.encode(), "inventory.xls")
        self.assertEqual("HTML table", source_format)
        self.assertEqual(3, processed)
        self.assertEqual(2, len(records))
        self.assertEqual(["PAO-DEMO-087", "PAO-DEMO-087"], [row["control_no"] for row in records])
        self.assertEqual(["Kennet Lico", "Christian Misal"], [row["client_name"] for row in records])
        self.assertEqual(["21", "26"], [row["age"] for row in records])
        self.assertEqual(["PP vs. Lico", "PP vs. Lico"], [row["title"] for row in records])

    @unittest.skipUnless(importlib.util.find_spec("openpyxl"), "openpyxl is not installed in this environment")
    def test_xlsx_detects_header_below_title_and_keeps_missing_client_name_blank(self):
        from openpyxl import Workbook

        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["PAO Case Inventory"])
        sheet.append(["CONTROL NUMBER", "AGE", "TITLE OF THE CASE", "STATUS OF THE CASE", "CASE RECEIVED"])
        sheet.append(["PAO-DEMO-101", 34, "Sample v. Client", "Pending", "2026-10-02"])
        stream = io.BytesIO()
        workbook.save(stream)
        records, _, source_format = read_workbook(stream.getvalue(), "inventory.xlsx")
        self.assertEqual("XLSX workbook", source_format)
        self.assertEqual(1, len(records))
        self.assertNotIn("client_name", records[0])
        self.assertEqual("PAO-DEMO-101", records[0]["control_no"])

    def test_unsupported_or_corrupt_file_is_rejected_by_content(self):
        with self.assertRaisesRegex(ValueError, "contents are not a supported"):
            read_workbook(b"not an excel workbook", "records.xlsx")


if __name__ == "__main__":
    unittest.main()
