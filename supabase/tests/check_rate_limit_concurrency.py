"""Verify atomic AI quotas against an explicitly selected local test database.

Example (use an isolated database with migrations applied):
  python3 supabase/tests/check_rate_limit_concurrency.py \
    --container supabase_db_example --database guardians_security_test

Creates one uniquely named fixture account, sends 24 concurrent requests at a
ceiling of five, and removes the account and its quota state in a finally block.
Uses the local container's psql; no hosted database URL or credentials are used.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--db-user", default="supabase_admin")
    args = parser.parse_args()
    command = [
        "docker", "exec", "-i", args.container, "psql", "-U", args.db_user,
        "-d", args.database, "-v", "ON_ERROR_STOP=1", "-Atq",
    ]

    def sql(statement):
        result = subprocess.run(
            command, input=statement, text=True, capture_output=True, check=True,
        )
        return result.stdout.strip()

    fixture_id = str(uuid.uuid4())
    sql(f"insert into auth.users(id,email) values "
        f"('{fixture_id}','quota-{fixture_id}@example.test');")
    try:
        def reserve(_):
            return sql(
                "begin; set local role authenticated; "
                f"set local request.jwt.claim.sub='{fixture_id}'; "
                "select public.check_ai_rate_limit('adoption_copy',5); commit;"
            )

        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(reserve, range(24)))
        report = {
            "concurrent_calls": len(results),
            "allowed": results.count("t"),
            "denied": results.count("f"),
            "unexpected": [result for result in results if result not in ("t", "f")],
            "stored_reservations": int(sql(
                "select cardinality(arrivals) from private.request_rate_windows "
                f"where user_id='{fixture_id}' and action='ai:adoption_copy';"
            )),
        }
        print(json.dumps(report))
        if report["allowed"] != 5 or report["denied"] != 19 or report["stored_reservations"] != 5:
            raise RuntimeError("Concurrent requests bypassed the configured quota")
    finally:
        sql(f"delete from auth.users where id='{fixture_id}';")


if __name__ == "__main__":
    main()
