#!/bin/bash
set -e

# === USER: UPDATE THIS TO YOUR REPO URL ===
GIT_REPO="https://github.com/yourusername/yourrepo.git"
PROJECT_DIR="aaad"

# Update and install system dependencies
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl python3 python3-pip python3-venv build-essential

# Install Node.js (LTS)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# (Optional) Install Ollama (if you want local LLMs)
curl -fsSL https://ollama.com/install.sh | sh || true

# Clone your repo
if [ ! -d "$PROJECT_DIR" ]; then
  git clone "$GIT_REPO" "$PROJECT_DIR"
fi
cd "$PROJECT_DIR"

echo "[INFO] Installing Node.js dependencies..."
npm install

echo "[INFO] Setting up Python venv and installing requirements..."
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "[INFO] Starting Python summarizer API in background..."
nohup venv/bin/python summarize_api.py > summarize_api.log 2>&1 &

echo "[INFO] Starting Node.js server in background..."
nohup node server.js > server.log 2>&1 &

echo "[SUCCESS] Agentic research stack is running!"
echo "Node.js API: http://<your-droplet-ip>:3000"
echo "Python summarizer: http://127.0.0.1:5000" 