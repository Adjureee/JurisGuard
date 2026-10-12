"""Print the exact PAO inventory for one local JPG, PNG, WEBP, or PDF.

Run from the repository root: python backend/extract_one.py path/to/document.png
This CLI never opens the production database and always selects offline mode.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ai_service import process_document
from extraction_mapping import public_extraction_payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Run local OCR and print the unified PAO inventory")
    parser.add_argument("document", type=Path, help="one JPG, PNG, WEBP, or PDF document")
    args = parser.parse_args()
    if args.document.suffix.lower() not in {".jpg", ".jpeg", ".jfif", ".png", ".webp", ".pdf"}:
        parser.error("document must be a JPG, PNG, WEBP, or PDF")
    if not args.document.is_file():
        parser.error("document file does not exist")
    result = public_extraction_payload(process_document(str(args.document), extraction_mode="offline"))
    print(json.dumps(result["inventory"], indent=2, ensure_ascii=False))
    print(
        f"document_type={result['document_type']} "
        f"engine={result['diagnostics'].get('ocr_engine')} "
        f"needs_review={result['needs_review']}",
        file=sys.stderr,
    )
    return 1 if result["extraction_mode"] in {"OFFLINE_OCR_FAILED", "OFFLINE_OCR_EMPTY"} else 0


if __name__ == "__main__":
    raise SystemExit(main())
