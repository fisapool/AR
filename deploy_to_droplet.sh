#!/bin/bash

DROPLET_IP=157.230.34.235
DROPLET_USER=root
GEMINI_API_KEY=AIzaSyBKkpVJtPZuUkZ5hxV_1LQPUAXHAKg0k3M

# Upload setup script
scp setup_agentic.sh $DROPLET_USER@$DROPLET_IP:/root/

# Run setup script
ssh $DROPLET_USER@$DROPLET_IP 'bash /root/setup_agentic.sh'

# Add .env file
ssh $DROPLET_USER@$DROPLET_IP "echo 'GEMINI_API_KEY=$GEMINI_API_KEY' > /root/aaad/.env"

# Restart Node.js server
ssh $DROPLET_USER@$DROPLET_IP 'pkill node || true; cd /root/aaad && nohup node server.js > server.log 2>&1 &'

echo "All done! Visit http://$DROPLET_IP:3000"