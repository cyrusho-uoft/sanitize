#!/bin/bash
# Setup script for the Prompt Sanitizer L2 backend
# Run this inside WSL: bash setup.sh

set -e

echo "=== U of T Prompt Sanitizer — L2 Backend Setup ==="

# Install system deps
echo "Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq python3-pip python3-venv curl

# Create virtual environment
echo "Creating Python virtual environment..."
python3 -m venv .venv
source .venv/bin/activate

# Install Python deps
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Download SpaCy model (~560MB)
echo "Downloading SpaCy NER model (this takes a minute)..."
python -m spacy download en_core_web_lg

echo ""
echo "=== Setup complete ==="
echo ""
echo "To start the server:"
echo "  source .venv/bin/activate"
echo "  uvicorn app.main:app --host 0.0.0.0 --port 8000"
echo ""
echo "Then test it:"
echo "  curl http://localhost:8000/healthz"
echo "  curl -X POST http://localhost:8000/api/v1/scan -H 'Content-Type: application/json' -d '{\"text\": \"Dr. Sarah Chen works at the University of Toronto\"}'"
