#!/usr/bin/env python3
"""Migrate data from local SQLite (Prisma epoch-ms dates) to Railway PostgreSQL"""
import sqlite3, sys, os
from datetime import datetime, timezone

try:
    import psycopg2
except ImportError:
    os.system("pip3 install psycopg2-binary --break-system-packages -q")
    import psycopg2

if len(sys.argv) < 2:
    print("Usage: python3 migrate_to_pg.py <RAILWAY_DATABASE_URL>")
    print("Get the PUBLIC URL from Railway dashboard → PostgreSQL service → Settings → Public Networking")
    sys.exit(1)

PG_URL = sys.argv[1]
SQLITE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", "prisma", "dev.db")

# Columns that are DateTime in Prisma (stored as epoch-ms bigints in SQLite)
DATETIME_COLS = {
    "date", "createdAt", "updatedAt", "fillingStartTime", "fillingEndTime",
    "setupEndTime", "reactionStartTime", "retentionStartTime", "transferTime",
    "cipStartTime", "cipEndTime", "setupTime_dt", "setupDate", "finalDate",
    "dosingEndTime", "addedAt", "setupTime_date",
    # PF fields
    "setupTime", "dosingEndTime", "transferTime", "cipStartTime", "cipEndTime",
}

# Some columns named 'setupTime' are actually strings in some tables
STRING_SETUP_TIME_TABLES = {"FermentationBatch"}

def convert_epoch_ms(val):
    """Convert epoch-ms bigint to ISO datetime string for PostgreSQL"""
    if val is None:
        return None
    if isinstance(val, int) and val > 1_000_000_000_000:  # epoch-ms (after year 2001)
        return datetime.fromtimestamp(val / 1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f+00')
    if isinstance(val, int) and val > 1_000_000_000:  # epoch-seconds
        return datetime.fromtimestamp(val, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f+00')
    return val  # already a string or something else

# Tables in FK-safe order
TABLES = [
    "User", "DailyEntry", "TankDip", "Settings", "GrainEntry", "MillingEntry",
    "RawMaterialEntry", "LiquefactionEntry", "PFChemical", "PFBatch", "PFDosing",
    "PFLabReading", "PreFermentationEntry", "FermentationEntry", "FermentationBatch",
    "FermChemical", "FermDosing", "DistillationEntry", "AuditLog",
]

def migrate():
    sq = sqlite3.connect(SQLITE_PATH)
    sq.row_factory = sqlite3.Row
    pg = psycopg2.connect(PG_URL)
    pg_cur = pg.cursor()

    total = 0
    for table in TABLES:
        try:
            rows = sq.execute(f'SELECT * FROM "{table}"').fetchall()
        except sqlite3.OperationalError:
            continue
        if not rows:
            continue

        cols = rows[0].keys()
        col_list = ", ".join(f'"{c}"' for c in cols)
        placeholders = ", ".join(["%s"] * len(cols))

        # Clear existing data
        try:
            pg_cur.execute(f'DELETE FROM "{table}"')
            pg.commit()
        except Exception as e:
            pg.rollback()
            print(f"  WARN: could not clear {table}: {e}")

        inserted = 0
        for row in rows:
            vals = []
            for c in cols:
                v = row[c]
                # Convert epoch-ms to timestamp for datetime columns
                if c in DATETIME_COLS and not (c == "setupTime" and table in STRING_SETUP_TIME_TABLES):
                    v = convert_epoch_ms(v)
                # Handle SQLite boolean (0/1) → Python bool for PG
                if c == "isActive" and isinstance(v, int):
                    v = bool(v)
                vals.append(v)

            try:
                pg_cur.execute(f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders})', tuple(vals))
                inserted += 1
            except Exception as e:
                pg.rollback()
                print(f"  SKIP row in {table}: {e}")
                continue

        pg.commit()
        if inserted:
            print(f"  {table}: {inserted} rows")
            total += inserted

    pg.close()
    sq.close()
    print(f"\nDone! {total} total rows migrated.")

if __name__ == "__main__":
    migrate()
