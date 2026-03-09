#!/usr/bin/env python3
"""Migrate data from local SQLite to Railway PostgreSQL"""
import sqlite3, sys, os
try:
    import psycopg2
except ImportError:
    os.system("pip3 install psycopg2-binary --break-system-packages -q")
    import psycopg2

if len(sys.argv) < 2:
    print("Usage: python3 migrate_to_pg.py <RAILWAY_DATABASE_URL>")
    print("Get the URL from Railway dashboard → PostgreSQL service → Variables → DATABASE_URL")
    sys.exit(1)

PG_URL = sys.argv[1]
SQLITE_PATH = os.path.join(os.path.dirname(__file__), "backend", "prisma", "dev.db")

# Tables to migrate in order (respecting foreign keys)
TABLES = [
    "User",
    "DailyEntry",
    "TankDip",
    "Settings",
    "GrainEntry",
    "MillingEntry",
    "RawMaterialEntry",
    "LiquefactionEntry",
    "PFChemical",
    "PFBatch",
    "PFDosing",
    "PFLabReading",
    "PreFermentationEntry",
    "FermentationEntry",
    "FermentationBatch",
    "FermChemical",
    "FermDosing",
    "DistillationEntry",
    "AuditLog",
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

        # Clear existing data in PG table first
        pg_cur.execute(f'DELETE FROM "{table}"')

        inserted = 0
        for row in rows:
            vals = tuple(row[c] for c in cols)
            try:
                pg_cur.execute(f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders})', vals)
                inserted += 1
            except Exception as e:
                print(f"  SKIP row in {table}: {e}")
                pg.rollback()
                continue

        pg.commit()
        if inserted:
            print(f"  {table}: {inserted} rows migrated")
            total += inserted

    pg.close()
    sq.close()
    print(f"\nDone! {total} total rows migrated.")

if __name__ == "__main__":
    migrate()
