#!/bin/bash
echo "Killing any existing processes..."
kill -9 $(lsof -ti:8000) 2>/dev/null
kill -9 $(lsof -ti:5173) 2>/dev/null

echo "Starting backend..."
cd "/Users/marcamaylunau/NAGINI 2.0/backend"
uvicorn main:app --reload --port 8000 &

sleep 3

echo "Starting frontend..."
cd "/Users/marcamaylunau/NAGINI 2.0"
npm run dev &

echo ""
echo "Akili running at http://localhost:5173"
