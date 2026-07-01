"""Pytest config: add backend dir to sys.path so `import source_status` etc. works."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
