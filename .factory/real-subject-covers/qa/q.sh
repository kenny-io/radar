#!/bin/sh
# QA helper: run one SQL statement against QA's app database (radar_qa_app on the throwaway Postgres at 55442).
exec psql -h 127.0.0.1 -p 55442 -U postgres -d radar_qa_app -At -c "$1"
