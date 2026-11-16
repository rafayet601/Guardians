"""Verify a claim lapse and a Guardian's renewal cannot both win.

Against an explicitly selected local test database: creates a synthetic
reporter, Guardian and several claimed reports whose leases have just lapsed,
then races the expiry job against the Guardian's comment and extension on each.
Removes its fixtures in a finally block. Never uses a hosted URL or credentials.
Example: --container supabase_db_example --database postgres
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
import uuid

ROUNDS = 12


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

    reporter_id = str(uuid.uuid4())
    guardian_id = str(uuid.uuid4())
    sightings = [str(uuid.uuid4()) for _ in range(ROUNDS)]
    sql("insert into auth.users(id,email) values "
        f"('{reporter_id}','lease-r-{reporter_id}@example.test'),"
        f"('{guardian_id}','lease-g-{guardian_id}@example.test');")
    try:
        # Claimed an hour ago; the lease lapsed a second ago. The lease trigger
        # sets a fresh lease on insert, so the lapse is written afterwards.
        values = ",".join(
            f"('{sid}','{reporter_id}','{guardian_id}',now() - interval '1 hour','claimed',"
            "st_setsrid(st_makepoint(-73,40),4326))"
            for sid in sightings
        )
        ids = ",".join(f"'{sid}'" for sid in sightings)
        sql("insert into public.sightings(id,reporter_id,claimed_by,claimed_at,status,location) "
            f"values {values};"
            "update public.sightings set claim_expires_at = now() - interval '1 second' "
            f"where id in ({ids});")

        def expire(_):
            return sql("select private.expire_stale_claims();", check=False).returncode

        def comment(sid):
            return sql(
                "insert into public.sighting_updates(sighting_id,author_id,type,body) values "
                f"('{sid}','{guardian_id}','comment','Still on it');",
                check=False,
            ).returncode

        def extend(sid):
            # A lapsed claim is refused; either answer is legitimate here.
            sql(
                "begin; set local role authenticated; "
                f"set local request.jwt.claim.sub='{guardian_id}'; "
                f"select public.extend_claim('{sid}'); commit;",
                check=False,
            )
            return 0

        with ThreadPoolExecutor(max_workers=16) as pool:
            # Interleaved so that some renewals land before the first expiry run
            # and some after; both outcomes are legitimate, a mix of the two on
            # one report is not.
            jobs = []
            for index, sid in enumerate(sightings):
                jobs.append(pool.submit(comment if index % 2 else extend, sid))
                if index % 2:
                    jobs.append(pool.submit(expire, None))
                jobs.append(pool.submit(extend if index % 2 else comment, sid))
            failures = sum(1 for job in jobs if job.result() != 0)

        rows = sql(
            "select s.id, s.status, s.claimed_by is not null, s.claim_expires_at is not null, "
            "coalesce(s.claim_expires_at > now(), false), "
            "(select count(*) from public.sighting_updates u where u.sighting_id = s.id "
            " and u.type = 'system' and u.new_status = 'spotted') "
            f"from public.sightings s where s.id in ({ids});"
        ).stdout.strip().splitlines()

        lapsed = kept = inconsistent = 0
        for row in rows:
            _, status, has_guardian, has_lease, lease_ahead, lapse_rows = row.split("|")
            if (status, has_guardian, has_lease, lapse_rows) == ("spotted", "f", "f", "1"):
                lapsed += 1
            elif (status, has_guardian, lease_ahead, lapse_rows) == ("claimed", "t", "t", "0"):
                kept += 1
            else:
                inconsistent += 1
        report = {
            "raced_claims": len(rows),
            "lapsed": lapsed,
            "kept_by_guardian": kept,
            "inconsistent": inconsistent,
            "failed_statements": failures,
        }
        print(json.dumps(report))
        if len(rows) != ROUNDS or inconsistent or failures:
            raise RuntimeError("A claim was both lapsed and renewed, or a statement failed")
    finally:
        sql(f"delete from auth.users where id in ('{reporter_id}','{guardian_id}');")


if __name__ == "__main__":
    main()
