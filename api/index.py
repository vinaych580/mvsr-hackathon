"""
Vercel serverless function entry point.
Wraps the FastAPI app from backend/main.py so Vercel can serve it
as a Python serverless function at /api/*.
"""
import sys
import os

# Add project root to sys.path so all imports (engine, ml, utils, backend) resolve
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from backend.main import app
