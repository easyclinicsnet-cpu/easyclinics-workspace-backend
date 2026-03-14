"""
AES-256-CBC Re-Key Migration Script
=====================================
Decrypts encrypted columns using the OLD key (with leading space)
and re-encrypts them with a NEW clean key (no space).

Targets only the exact columns that are encrypted per table,
derived from each repository's isSensitiveField() + the base class.

Usage:
  pip install mysql-connector-python pycryptodome

  python rekey-migration.py --dry-run          # Preview (no writes)
  python rekey-migration.py --execute          # Apply changes
  python rekey-migration.py --execute --batch 500
"""

import argparse
import hashlib
import os
import re
import sys
import time

import mysql.connector
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad


# ──────────────────────────────────────────────
#  Keys
# ──────────────────────────────────────────────

OLD_KEY_SECRET = " wkqJUEaJWhzgBuHUu9zkc04/KicdB3QZXEMVkLnTbK0="   # leading space (Plesk)
NEW_KEY_SECRET = "29e95bf8-5a97-4df3-8b4f-02624c5c4d94"    # clean (new backend)

SCRYPT_SALT   = b"secure-salt"
SCRYPT_KEYLEN = 32
SCRYPT_N      = 16384   # Node.js crypto.scrypt defaults
SCRYPT_R      = 8
SCRYPT_P      = 1


# ──────────────────────────────────────────────
#  Database
# ──────────────────────────────────────────────

DB_CONFIG = {
    "host":     "127.0.0.1",
    "port":     3306,
    "user":     "root",
    "password": "",
    "database": "kensington24hr-real-data",
}


# ──────────────────────────────────────────────
#  Encrypted column map
#  Source: each repo's isSensitiveField() + base class fields
#  Dot-notation paths (relation search helpers) are excluded —
#  they are not actual DB columns.
# ──────────────────────────────────────────────
#
#  Base class sensitive fields (all repos inherit these):
#    content, firstName, lastName, email, phone, ssn, nationalId,
#    address, chiefComplaint, description, assessment,
#    medicine, dose, route, frequency, days
#    + pattern: /password|secret|token|creditCard|private|medical|health/i

ENCRYPTED_COLUMNS: dict[str, list[str]] = {

    # patient.repository.ts  →  @Entity('patients')
    "patients": [
        "firstName", "lastName", "fileNumber", "phoneNumber",
        "email", "city", "address", "nationalId",
        "medicalAid", "membershipNumber",
        # base class fields that may also exist on patient rows
        "phone", "ssn", "content", "description",
    ],

    # prescription.repository.ts  →  @Entity('prescriptions')
    "prescriptions": [
        "medicine", "dose", "route", "frequency", "days",
    ],

    # social-history.repository.ts  →  @Entity('social_history')
    "social_history": [
        "occupation", "additionalNotes",
        # base
        "description",
    ],

    # surgical-history/history.repository.ts  →  @Entity('past_surgical_history')
    "past_surgical_history": [
        "name", "description",
        # entity may use these column names instead
        "procedure", "details",
    ],

    # vital.repository.ts  →  @Entity('vitals')
    "vitals": [
        "temperature", "bloodPressure", "heartRate",
        "saturation", "gcs", "bloodGlucose", "height", "weight",
    ],

    # allergy.repository.ts  →  @Entity('allergies')
    "allergies": [
        "substance", "reaction",
    ],

    # appointment.repository.ts  →  @Entity('appointments')
    "appointments": [
        "notes", "diagnosis", "patientNotes", "privateNotes",
        # base
        "description", "assessment", "chiefComplaint",
    ],

    # ai-note-source.repository.ts  →  @Entity('care_ai_note_sources')
    "care_ai_note_sources": [
        "sourceContent", "metadata",
        # base
        "content",
    ],

    # note-permission.repository.ts  →  @Entity('care_note_permissions')
    # only super.isSensitiveField — include base fields that could exist here
    "care_note_permissions": [
        "content", "description",
    ],

    # note-template.repository.ts  →  @Entity('care_note_templates')
    "care_note_templates": [
        "template", "description",
        # base
        "content",
    ],

    # note-timeline.repository.ts  →  @Entity('care_note_timelines')
    # only super.isSensitiveField
    "care_note_timelines": [
        "content", "description",
    ],

    # note-version.repository.ts  →  @Entity('note_versions')
    "note_versions": [
        "content", "aiMetadata", "reviewOfSystems", "physicalExam",
        "assessment", "chiefComplaint", "historyOfPresentIllness",
        "procedureDescription", "findings", "diagnosis", "treatmentPlan",
        # base
        "description",
    ],

    # note.repository.ts  →  @Entity('care_notes')
    "care_notes": [
        "content",
        # base
        "description", "assessment", "chiefComplaint",
    ],

    # consultation-collaborator.repository.ts  →  @Entity('consultation_collaborators')
    "consultation_collaborators": [
        "notes",
        # base
        "description",
    ],

    # consultation.repository.ts  →  @Entity('consultations')
    "consultations": [
        "notes", "diagnosis",
        # base
        "description", "assessment", "chiefComplaint",
    ],

    # medication.repository.ts  →  @Entity('current-medications')
    "current-medications": [
        "name", "dose", "frequency",
        # base
        "medicine", "route", "days",
    ],

    # family-condition.repository.ts  →  @Entity('family_conditions')
    "family_conditions": [
        "relation", "condition", "notes",
        # base
        "description",
    ],

    # medical-history/history.repository.ts  →  @Entity('past_medical_history')
    "past_medical_history": [
        "name", "description",
        # entity may use these column names
        "condition", "details",
    ],
}

# Regex: exactly 32 lowercase hex chars, colon, 32+ lowercase hex chars
ENCRYPTED_RE = re.compile(r"^[0-9a-f]{32}:[0-9a-f]{32,}$")


# ──────────────────────────────────────────────
#  Crypto helpers (identical to Node.js Aes256Service)
# ──────────────────────────────────────────────

def derive_key(secret: str) -> bytes:
    return hashlib.scrypt(
        password=secret.encode("utf-8"),
        salt=SCRYPT_SALT,
        n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
        dklen=SCRYPT_KEYLEN,
    )


def decrypt_value(encrypted_text: str, key: bytes) -> str:
    iv_hex, content_hex = encrypted_text.split(":", 1)
    iv = bytes.fromhex(iv_hex)
    ciphertext = bytes.fromhex(content_hex)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    return unpad(cipher.decrypt(ciphertext), AES.block_size).decode("utf-8")


def encrypt_value(plaintext: str, key: bytes) -> str:
    iv = os.urandom(16)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    ciphertext = cipher.encrypt(pad(plaintext.encode("utf-8"), AES.block_size))
    return f"{iv.hex()}:{ciphertext.hex()}"


def is_encrypted(value) -> bool:
    if not value or not isinstance(value, str):
        return False
    return bool(ENCRYPTED_RE.match(value))


# ──────────────────────────────────────────────
#  Helpers
# ──────────────────────────────────────────────

def get_primary_key(cursor, database: str, table: str) -> str | None:
    cursor.execute("""
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
          AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION LIMIT 1
    """, (database, table))
    row = cursor.fetchone()
    return row[0] if row else None


def get_existing_columns(cursor, database: str, table: str) -> set[str]:
    cursor.execute("""
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
    """, (database, table))
    return {row[0] for row in cursor.fetchall()}


def table_exists(cursor, database: str, table: str) -> bool:
    cursor.execute("""
        SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
    """, (database, table))
    return cursor.fetchone()[0] > 0


# ──────────────────────────────────────────────
#  Migration
# ──────────────────────────────────────────────

def migrate(dry_run: bool, batch_size: int):
    print("=" * 60)
    print("  AES-256-CBC Re-Key Migration")
    print(f"  Mode: {'DRY RUN (no changes)' if dry_run else 'EXECUTE (modifies DB)'}")
    print("=" * 60)

    print("\nDeriving keys...")
    old_key = derive_key(OLD_KEY_SECRET)
    new_key = derive_key(NEW_KEY_SECRET)

    if old_key == new_key:
        print("ERROR: Old and new keys are identical — nothing to do.")
        sys.exit(1)

    print(f"  Old key: {old_key.hex()[:16]}...  (with leading space)")
    print(f"  New key: {new_key.hex()[:16]}...  (clean)")

    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()

    stats = {
        "tables_processed": 0,
        "columns_checked":  0,
        "rows_scanned":     0,
        "encrypted_found":  0,
        "re_encrypted":     0,
        "skipped_tables":   0,
        "skipped_columns":  0,
    }

    start = time.time()

    for table, candidate_cols in sorted(ENCRYPTED_COLUMNS.items()):

        # Table existence check
        if not table_exists(cursor, DB_CONFIG["database"], table):
            print(f"  [SKIP] {table} — table not found")
            stats["skipped_tables"] += 1
            continue

        pk_col = get_primary_key(cursor, DB_CONFIG["database"], table)
        if not pk_col:
            print(f"  [SKIP] {table} — no primary key")
            stats["skipped_tables"] += 1
            continue

        # Only work with columns that actually exist in the table
        existing = get_existing_columns(cursor, DB_CONFIG["database"], table)
        # Deduplicate while preserving order
        seen = set()
        cols = []
        for c in candidate_cols:
            if c not in seen and c in existing and c != pk_col:
                seen.add(c)
                cols.append(c)

        if not cols:
            print(f"  [SKIP] {table} — no matching columns")
            stats["skipped_columns"] += 1
            continue

        stats["tables_processed"] += 1
        table_rekey_count = 0

        col_list = ", ".join(f"`{c}`" for c in [pk_col] + cols)
        offset = 0

        while True:
            cursor.execute(
                f"SELECT {col_list} FROM `{table}` LIMIT %s OFFSET %s",
                (batch_size, offset),
            )
            rows = cursor.fetchall()
            if not rows:
                break

            for row in rows:
                stats["rows_scanned"] += 1
                pk_value = row[0]

                for idx, col_name in enumerate(cols, start=1):
                    stats["columns_checked"] += 1
                    cell = row[idx]

                    if not is_encrypted(cell):
                        continue

                    stats["encrypted_found"] += 1

                    try:
                        plaintext = decrypt_value(cell, old_key)
                        new_val   = encrypt_value(plaintext, new_key)

                        if not dry_run:
                            cursor.execute(
                                f"UPDATE `{table}` SET `{col_name}` = %s "
                                f"WHERE `{pk_col}` = %s",
                                (new_val, pk_value),
                            )

                        stats["re_encrypted"] += 1
                        table_rekey_count += 1

                    except Exception:
                        # Decryption with old key failed — check why:
                        try:
                            decrypt_value(cell, new_key)
                            # Already re-keyed with new key — skip silently
                            stats["encrypted_found"] -= 1  # not a pending item
                        except Exception:
                            # Matches the hex pattern but is not AES data
                            # (e.g. a plain UUID or membership code). Skip silently.
                            stats["encrypted_found"] -= 1

            offset += batch_size

        if table_rekey_count > 0 or True:  # always show processed tables
            verb = "would re-key" if dry_run else "re-keyed"
            print(f"  [{table}] {table_rekey_count} values {verb}  "
                  f"(cols: {', '.join(cols)})")

    if not dry_run and stats["re_encrypted"] > 0:
        print("\nCommitting...")
        conn.commit()
        print("COMMITTED.")
    else:
        conn.rollback()

    cursor.close()
    conn.close()

    elapsed = time.time() - start
    print("\n" + "=" * 60)
    print("  Summary")
    print("=" * 60)
    print(f"  Tables processed:    {stats['tables_processed']}")
    print(f"  Tables skipped:      {stats['skipped_tables']}")
    print(f"  Rows scanned:        {stats['rows_scanned']:,}")
    print(f"  Pending re-key:      {stats['encrypted_found']:,}")
    print(f"  Re-encrypted:        {stats['re_encrypted']:,}")
    print(f"  Time:                {elapsed:.1f}s")
    print("=" * 60)

    if dry_run and stats["re_encrypted"] > 0:
        print(f"\n  Run with --execute to apply {stats['re_encrypted']} changes.")

    return True


# ──────────────────────────────────────────────
#  CLI
# ──────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Re-key AES-256-CBC encrypted DB fields")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run",  action="store_true", help="Preview only")
    group.add_argument("--execute",  action="store_true", help="Apply changes")
    parser.add_argument("--batch",       type=int, default=500,  help="Rows per batch (default 500)")
    parser.add_argument("--db-host",     type=str)
    parser.add_argument("--db-port",     type=int)
    parser.add_argument("--db-user",     type=str)
    parser.add_argument("--db-password", type=str)
    parser.add_argument("--db-name",     type=str)
    args = parser.parse_args()

    if args.db_host:     DB_CONFIG["host"]     = args.db_host
    if args.db_port:     DB_CONFIG["port"]     = args.db_port
    if args.db_user:     DB_CONFIG["user"]     = args.db_user
    if args.db_password: DB_CONFIG["password"] = args.db_password
    if args.db_name:     DB_CONFIG["database"] = args.db_name

    if args.execute:
        print("\n  WARNING: This will permanently modify encrypted data.")
        print("  Take a DB backup before proceeding.\n")
        if input("  Type 'YES' to continue: ") != "YES":
            print("Aborted.")
            sys.exit(0)

    sys.exit(0 if migrate(dry_run=args.dry_run, batch_size=args.batch) else 1)
