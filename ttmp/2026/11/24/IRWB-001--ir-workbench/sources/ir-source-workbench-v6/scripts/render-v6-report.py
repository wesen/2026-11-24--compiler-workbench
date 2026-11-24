"""Compatibility entry point: v6's report is now the complete user guide.

Usage: python scripts/render-v6-report.py [markdown] [pdf].
The default inputs and output match scripts/render-user-guide.py.
"""
import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).with_name('render-user-guide.py')), run_name='__main__')
