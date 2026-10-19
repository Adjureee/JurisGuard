"""Central test package for the application and isolated extraction lab."""

from pathlib import Path
import sys


_ROOT = Path(__file__).resolve().parent.parent
for _relative in ("backend", "jurisguard-extraction-lab"):
    _path = str(_ROOT / _relative)
    if _path not in sys.path:
        sys.path.insert(0, _path)
