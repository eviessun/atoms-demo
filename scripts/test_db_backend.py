"""End-to-end smoke test for the persistence layer against whichever backend
DATABASE_URL selects (Postgres if set, else SQLite). Run:

    python -m scripts.test_db_backend

It exercises the full public API and asserts owner isolation. Safe to run
repeatedly: it uses a unique email each run and only touches its own rows.
"""
import sys
import time

from app import db


def main() -> int:
    print(f"backend = {'POSTGRES' if db.IS_POSTGRES else 'SQLITE'}")
    db.init_db()

    stamp = int(time.time() * 1000)
    email_a = f"tester_a_{stamp}@example.com"
    email_b = f"tester_b_{stamp}@example.com"

    # users
    uid_a = db.create_user(email_a, "hash_a")
    uid_b = db.create_user(email_b, "hash_b")
    assert uid_a and uid_b and uid_a != uid_b, "user ids must be distinct/truthy"
    got = db.get_user_by_email(email_a)
    assert got["email"] == email_a and got["password_hash"] == "hash_a"
    print(f"users OK (uid_a={uid_a}, uid_b={uid_b})")

    # sessions
    token = f"tok_{stamp}"
    db.create_session(token, uid_a)
    sess_user = db.get_user_by_session(token)
    assert sess_user["id"] == uid_a, "session should resolve to user A"
    print("session create/resolve OK")

    # projects
    pid1 = db.create_project(uid_a, "make a todo app", "<h1>todo</h1>", "mock")
    pid2 = db.create_project(uid_a, "make a timer", "<h1>timer</h1>", "mock")
    assert pid1 and pid2 and pid1 != pid2
    rows = db.list_projects(uid_a)
    assert len(rows) >= 2, "user A should see >= 2 projects"
    assert rows[0]["id"] == pid2, "list must be newest-first (id DESC)"
    print(f"projects create/list OK (pid1={pid1}, pid2={pid2}, listed={len(rows)})")

    # owner isolation: B cannot read A's project
    assert db.get_project(uid_a, pid1) is not None, "owner should read own project"
    assert db.get_project(uid_b, pid1) is None, "non-owner must NOT read project"
    print("owner isolation OK")

    # logout invalidates session
    db.delete_session(token)
    assert db.get_user_by_session(token) is None, "deleted session must not resolve"
    print("session delete OK")

    print("\nALL DB BACKEND TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
