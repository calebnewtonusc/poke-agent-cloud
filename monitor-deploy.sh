#!/bin/bash
echo "[1] Waiting for new deployment to start..."
sleep 5

for i in {2..30}; do
  echo "[$i] Checking deployment status..."
  
  # Check if service is live by hitting health endpoint
  if curl -s -f http://poke-agent-cloud.onrender.com/health > /dev/null 2>&1; then
    echo "✓ Service is responding on health endpoint"
    echo "✓ Deployment appears successful"
    echo ""
    echo "Please send 'Test 5' to Poke to test the error logging"
    exit 0
  fi
  
  sleep 10
done

echo "Deployment monitoring timed out after 5 minutes"
echo "Please check Render dashboard manually"
