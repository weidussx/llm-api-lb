#!/bin/bash

# Find process by port (default 8787) or by script name
PORT=${PORT:-8787}

echo "Stopping llm-key-lb..."

# Try to find PID listening on port
PID=$(lsof -t -i:$PORT)

if [ -n "$PID" ]; then
  echo "Found process $PID listening on port $PORT. Killing..."
  kill $PID
  echo "Stopped."
else
  echo "No process found listening on port $PORT."
  
  # Fallback: try to find by process name (node server.js)
  # Be careful not to kill other node processes
  PIDS=$(ps aux | grep "[n]ode .*server.js" | awk '{print $2}')
  if [ -n "$PIDS" ]; then
    echo "Found node server.js process(es): $PIDS. Killing..."
    kill $PIDS
    echo "Stopped."
  else
    echo "No running server.js found."
  fi
fi
