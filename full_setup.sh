#!/bin/bash
cd /root
rm -rf aaad
git clone git@github.com:fisapool/AR.git aaad
cd aaad
echo 'GEMINI_API_KEY=AIzaSyBKkpVJtPZuUkZ5hxV_1LQPUAXHAKg0k3M' > .env
bash setup_agentic.sh