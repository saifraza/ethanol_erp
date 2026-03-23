#!/bin/bash
cd "$(dirname "$0")/backend"
echo "MSPIL Distillery ERP"
echo "Starting on http://localhost:3001"
echo "Press Ctrl+C to stop"
node dist/server.js
