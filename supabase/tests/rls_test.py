#!/usr/bin/env python3
"""
Grainflow row-level security test suite.

Runs every assertion as a real authenticated session — SET ROLE authenticated
plus a JWT subject claim — because a superuser bypasses RLS entirely and would
make every one of these pass regardless of the policies.

Each case is (label, user, sql, expectation). Expectation is either a row count
or 'denied', meaning the statement must raise.
"""

import subprocess
import sys

HOST, PORT, DB = "/tmp/pgtest", "55432", "grainflow"

USERS = {
    "owner":      "a0000000-0000-0000-0000-000000000001",
    "manager":    "a0000000-0000-0000-0000-000000000002",
    "bookkeeper": "a0000000-0000-0000-0000-000000000003",
    "worker":     "a0000000-0000-0000-0000-000000000004",
    "driver":     "a0000000-0000-0000-0000-000000000005",
    "farmB":      "b0000000-0000-0000-0000-000000000001",
}

FARM_A = "11111111-0000-0000-0000-00000000000a"
OPEN_TICKET = "77777777-0000-0000-0000-000000000001"
CLOSED_TICKET = "77777777-0000-0000-0000-000000000002"


def run_as(user, sql):
    """Execute sql as `user`, returning (ok, output)."""
    script = (
        f"set role authenticated;\n"
        f"set request.jwt.claim.sub = '{USERS[user]}';\n"
        f"{sql}\n"
    )
    p = subprocess.run(
        ["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB,
         "-tA", "-v", "ON_ERROR_STOP=1"],
        input=script, capture_output=True, text=True,
    )
    return p.returncode == 0, (p.stdout + p.stderr).strip()


def count(user, table, where="true"):
    ok, out = run_as(user, f"select count(*) from {table} where {where};")
    if not ok:
        return None
    return int(out.splitlines()[-1])


CASES = []


def case(label, fn, expected):
    CASES.append((label, fn, expected))


# --- cross-tenant isolation: the failure that ends the business ---------------
for role in ("owner", "manager", "bookkeeper", "worker", "driver"):
    case(f"{role}: sees only farm A farms",
         lambda r=role: count(r, "farms"), 1)
    case(f"{role}: sees no farm B movements",
         lambda r=role: count(r, "movements", "farm_id <> '%s'" % FARM_A), 0)
case("farm B owner: sees nothing of farm A",
     lambda: count("farmB", "movements", "farm_id = '%s'" % FARM_A), 0)
case("farm B owner: cannot read farm A sale_terms",
     lambda: count("farmB", "sale_terms"), 0)

# --- the price split: sale_terms must not reach the field --------------------
case("owner: reads sale_terms", lambda: count("owner", "sale_terms"), 1)
case("bookkeeper: reads sale_terms", lambda: count("bookkeeper", "sale_terms"), 1)
case("manager: CANNOT read sale_terms", lambda: count("manager", "sale_terms"), 0)
case("worker: CANNOT read sale_terms", lambda: count("worker", "sale_terms"), 0)
case("driver: CANNOT read sale_terms", lambda: count("driver", "sale_terms"), 0)

# --- but the contract picker still works -------------------------------------
case("driver: CAN read sales (contract picker)", lambda: count("driver", "sales"), 1)
case("worker: CAN read sales", lambda: count("worker", "sales"), 1)

# --- agronomy split ----------------------------------------------------------
case("worker: reads field_agronomy", lambda: count("worker", "field_agronomy"), 1)
case("driver: CANNOT read field_agronomy", lambda: count("driver", "field_agronomy"), 0)
case("driver: CAN read fields (paddock picker)",
     lambda: count("driver", "fields", "name = 'Home Block'"), 1)

# --- financials --------------------------------------------------------------
case("owner: reads overheads", lambda: count("owner", "overheads"), 1)
case("bookkeeper: reads overheads", lambda: count("bookkeeper", "overheads"), 1)
case("manager: CANNOT read overheads", lambda: count("manager", "overheads"), 0)
case("driver: CANNOT read overheads", lambda: count("driver", "overheads"), 0)
case("manager: CANNOT read invoices", lambda: count("manager", "invoices"), 0)
case("bookkeeper: reads invoices", lambda: count("bookkeeper", "invoices"), 1)

# --- open loads are a hand-off; closed ones are not --------------------------
def upd(user, ticket, field="tons = 99"):
    ok, _ = run_as(user, f"update movements set {field} where id = '{ticket}';")
    if not ok:
        return "denied"
    n = count(user, "movements", f"id = '{ticket}' and tons = 99")
    run_as("owner", f"update movements set tons = 32.5 where id = '{ticket}';")
    return "changed" if n == 1 else "no-op"

case("driver: CAN amend an open load", lambda: upd("driver", OPEN_TICKET), "changed")
case("worker: CAN amend an open load (not theirs)", lambda: upd("worker", OPEN_TICKET), "changed")
case("driver: CANNOT amend a closed load", lambda: upd("driver", CLOSED_TICKET), "no-op")
case("worker: CANNOT amend a closed load", lambda: upd("worker", CLOSED_TICKET), "no-op")
case("manager: CAN amend a closed load", lambda: upd("manager", CLOSED_TICKET), "changed")

# --- write scopes ------------------------------------------------------------
def try_insert(user, sql, cleanup=None):
    """Run a write as `user`. Any row it created is removed afterwards as
    superuser, so the suite gives the same result on the tenth run as the first."""
    ok, _ = run_as(user, sql)
    if cleanup:
        subprocess.run(
            ["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-q", "-c", cleanup],
            capture_output=True, text=True)
    return "allowed" if ok else "denied"

case("worker: CAN write production",
     lambda: try_insert("worker",
        f"insert into fields (id, farm_id, season_id, name) values "
        f"(gen_random_uuid(), '{FARM_A}', '22222222-0000-0000-0000-00000000000a', 'W test');",
        "delete from fields where name = 'W test';"),
     "allowed")
case("driver: CANNOT write production",
     lambda: try_insert("driver",
        f"insert into fields (id, farm_id, season_id, name) values "
        f"(gen_random_uuid(), '{FARM_A}', '22222222-0000-0000-0000-00000000000a', 'D test');",
        "delete from fields where name = 'D test';"),
     "denied")
case("bookkeeper: CANNOT create a movement",
     lambda: try_insert("bookkeeper",
        f"insert into movements (id, farm_id, season_id, tons) values "
        f"(gen_random_uuid(), '{FARM_A}', '22222222-0000-0000-0000-00000000000a', 5);",
        "delete from movements where tons = 5;"),
     "denied")
case("driver: CAN create a movement",
     lambda: try_insert("driver",
        f"insert into movements (id, farm_id, season_id, tons) values "
        f"(gen_random_uuid(), '{FARM_A}', '22222222-0000-0000-0000-00000000000a', 5);",
        "delete from movements where tons = 5;"),
     "allowed")
case("manager: CANNOT write sale_terms",
     lambda: try_insert("manager",
        f"insert into sale_terms (id, farm_id, sale_id, price) values "
        f"(gen_random_uuid(), '{FARM_A}', '66666666-0000-0000-0000-00000000000a', 1);",
        "delete from sale_terms where price = 1;"),
     "denied")

# --- nothing may hard-delete, ever -------------------------------------------
for role in ("owner", "manager", "bookkeeper", "worker", "driver"):
    case(f"{role}: CANNOT hard-delete",
         lambda r=role: try_insert(r, f"delete from movements where id = '{OPEN_TICKET}';"),
         "denied")


def main():
    passed = failed = 0
    for label, fn, expected in CASES:
        try:
            actual = fn()
        except Exception as e:                     # noqa: BLE001
            actual = f"error: {e}"
        if actual == expected:
            passed += 1
            print(f"  PASS  {label}")
        else:
            failed += 1
            print(f"  FAIL  {label}  (expected {expected!r}, got {actual!r})")
    print(f"\n{passed} passed, {failed} failed, {len(CASES)} total")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
