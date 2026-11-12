#!/bin/sh
# QA helper: run one SQL statement against QA's app database (radar_qa_app on the throwaway Postgres).
exec /opt/homebrew/opt/postgresql@16/bin/psql -h 127.0.0.1 -p 55432 -U postgres -d radar_qa_app -At -c "$1"
