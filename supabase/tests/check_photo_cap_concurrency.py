"""Verify attachment limits against an explicitly selected local test database.

Creates a unique synthetic account/report, sends 20 concurrent inserts, and
removes fixtures in a finally block. Never uses a hosted URL or credentials.
Example: --container supabase_db_example --database postgres
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

    def sql(statement, check=True):
        return subprocess.run(
            command, input=statement, text=True, capture_output=True, check=check,
        )

    account_id = str(uuid.uuid4())
    sighting_id = str(uuid.uuid4())
    sql(f"insert into auth.users(id,email) values "
        f"('{account_id}','photos-{account_id}@example.test');")
    try:
        sql("insert into public.sightings(id,reporter_id,location) values "
            f"('{sighting_id}','{account_id}',st_setsrid(st_makepoint(-73,40),4326));")

        def attach(index):
            result = sql(
                "begin; set local role authenticated; "
                f"set local request.jwt.claim.sub='{account_id}'; "
                "insert into public.sighting_photos(sighting_id,uploaded_by,url) values "
                f"('{sighting_id}','{account_id}','https://example.test/{index}.jpg'); commit;",
                check=False,
            )
            if result.returncode == 0:
                return "allowed"
            if "maximum number of photos" in result.stderr:
                return "denied"
            return "unexpected"

        with ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(attach, range(20)))
        report = {
            "concurrent_inserts": len(results),
            "allowed": results.count("allowed"),
            "denied": results.count("denied"),
            "unexpected": results.count("unexpected"),
            "stored_photos": int(sql(
                f"select count(*) from public.sighting_photos where sighting_id='{sighting_id}';"
            ).stdout.strip()),
        }
        print(json.dumps(report))
        if report["allowed"] != 12 or report["denied"] != 8 or report["stored_photos"] != 12:
            raise RuntimeError("Concurrent attachments bypassed the photo ceiling")
    finally:
        sql(f"delete from auth.users where id='{account_id}';")


if __name__ == "__main__":
    main()
