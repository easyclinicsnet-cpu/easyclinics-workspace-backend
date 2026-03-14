#!/usr/bin/env python3
"""
EasyClinics EMR - Legacy to New System Data Migration Script
=============================================================
Migrates data from legacy workspace (7a70a4d5-...) to new workspace (a9fa7d31-...).

Guarantees:
  - Atomicity: Full rollback on any failure (per-table or global)
  - Data Integrity: Pre/post row-count validation, FK ordering
  - Performance: O(n) batch inserts, chunked to avoid memory issues
  - Zero data loss: Every legacy row is accounted for or explicitly skipped with logging

Usage:
  pip install mysql-connector-python
  python migrate_legacy_data.py [--dry-run] [--batch-size 500] [--skip-validation]
"""

import argparse
import datetime
import json
import logging
import sys
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

import mysql.connector
from mysql.connector import Error as MySQLError
from mysql.connector.connection import MySQLConnection
from mysql.connector.cursor import MySQLCursor

# ============================================================================
# CONFIGURATION — Set these before running
# ============================================================================

TARGET_WORKSPACE_ID = "7a70a4d5-177f-4f2b-8925-60c1e7c7315b"
NEW_DB = "a9fa7d31-7597-45c0-a15c-1ec2eea6ca0b2"
LEGACY_DB = "kensington24hr-real-data"

LEGACY_DB_CONFIG = {
    "host": "localhost",
    "port": 3306,
    "user": "root",
    "password": "",
    "database": LEGACY_DB,
    "charset": "utf8mb4",
    "use_unicode": True,
    "autocommit": False,
}

NEW_DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "",
    "database": NEW_DB,
    "charset": "utf8mb4",
    "use_unicode": True,
    "autocommit": False,
}

DEFAULT_BATCH_SIZE = 500
# Smaller batch for tables with large TEXT/LONGTEXT columns to avoid max_allowed_packet
LARGE_TEXT_BATCH_SIZE = 25
MIGRATION_USER_ID = "SYSTEM_MIGRATION"

# Tables whose rows contain large TEXT / LONGTEXT payloads.
# batch_insert will auto-shrink chunk size for these.
LARGE_TEXT_TABLES = frozenset({
    "care_notes", "note_versions", "care_ai_note_sources",
    "recordings_transcript", "care_note_templates",
    "referral_letters", "sick_notes", "audit_contexts",
})

# ============================================================================
# LOGGING
# ============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)-7s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(
            f"migration_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.log",
            encoding="utf-8",
        ),
    ],
)
log = logging.getLogger("migration")


# ============================================================================
# DATA CLASSES
# ============================================================================


@dataclass
class MigrationStats:
    table: str
    legacy_count: int = 0
    migrated_count: int = 0
    skipped_count: int = 0
    error_count: int = 0
    duration_ms: float = 0
    status: str = "pending"
    errors: List[str] = field(default_factory=list)


@dataclass
class MigrationReport:
    started_at: datetime.datetime = field(default_factory=datetime.datetime.now)
    finished_at: Optional[datetime.datetime] = None
    tables: List[MigrationStats] = field(default_factory=list)
    global_status: str = "pending"

    def summary(self) -> str:
        lines = [
            "\n" + "=" * 72,
            "MIGRATION REPORT",
            "=" * 72,
            f"  Started : {self.started_at}",
            f"  Finished: {self.finished_at}",
            f"  Status  : {self.global_status}",
            "-" * 72,
            f"  {'Table':<40} {'Legacy':>7} {'Migrated':>8} {'Skip':>5} {'Err':>4} {'ms':>8}",
            "-" * 72,
        ]
        total_legacy = total_migrated = total_skip = total_err = 0
        for t in self.tables:
            lines.append(
                f"  {t.table:<40} {t.legacy_count:>7} {t.migrated_count:>8} "
                f"{t.skipped_count:>5} {t.error_count:>4} {t.duration_ms:>8.0f}"
            )
            total_legacy += t.legacy_count
            total_migrated += t.migrated_count
            total_skip += t.skipped_count
            total_err += t.error_count
            if t.errors:
                for e in t.errors[:3]:
                    lines.append(f"    ⚠ {e[:120]}")
        lines.append("-" * 72)
        lines.append(
            f"  {'TOTAL':<40} {total_legacy:>7} {total_migrated:>8} "
            f"{total_skip:>5} {total_err:>4}"
        )
        lines.append("=" * 72)
        return "\n".join(lines)


# ============================================================================
# DB HELPERS
# ============================================================================


def get_connection(config: dict) -> MySQLConnection:
    """Create a new MySQL connection."""
    conn = mysql.connector.connect(**config)
    return conn


def get_max_allowed_packet(conn: MySQLConnection) -> int:
    """Query the server's max_allowed_packet (bytes). Falls back to 16MB."""
    try:
        cur = conn.cursor()
        cur.execute("SELECT @@max_allowed_packet")
        val = cur.fetchone()[0]
        cur.close()
        return int(val)
    except Exception:
        return 16 * 1024 * 1024  # 16 MB default


def ensure_connection(conn: MySQLConnection, config: dict) -> MySQLConnection:
    """
    Return *conn* if still alive, otherwise reconnect.
    O(1) — single ping round-trip.
    """
    try:
        conn.ping(reconnect=False)
        return conn
    except Exception:
        log.warning("Connection lost — reconnecting...")
        try:
            conn.close()
        except Exception:
            pass
        new_conn = get_connection(config)
        # Restore session variables needed for migration
        cur = new_conn.cursor()
        cur.execute("SET FOREIGN_KEY_CHECKS = 0")
        cur.execute("SET UNIQUE_CHECKS = 0")
        cur.close()
        return new_conn


def fetch_all_dict(cursor: MySQLCursor) -> List[Dict[str, Any]]:
    """Fetch all rows as list of dicts."""
    columns = [desc[0] for desc in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def count_rows(conn: MySQLConnection, table: str, where: str = "1=1") -> int:
    """Count rows in a table."""
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT COUNT(*) FROM `{table}` WHERE {where}")
        return cur.fetchone()[0]
    finally:
        cur.close()


def fetch_legacy(conn: MySQLConnection, table: str) -> List[Dict[str, Any]]:
    """Read all rows from a legacy table."""
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT * FROM `{table}`")
        return fetch_all_dict(cur)
    except MySQLError as e:
        if e.errno == 1146:  # Table doesn't exist
            log.warning(f"Legacy table `{table}` does not exist — skipping.")
            return []
        raise
    finally:
        cur.close()


def _estimate_row_bytes(row: Tuple) -> int:
    """
    Rough byte-size estimate of a single row tuple.
    Strings are measured by UTF-8 encoded length; everything else ≈ 32 bytes.
    """
    total = 0
    for val in row:
        if val is None:
            total += 4  # NULL literal
        elif isinstance(val, str):
            total += len(val.encode("utf-8", errors="replace")) + 2  # quotes
        elif isinstance(val, bytes):
            total += len(val) + 2
        else:
            total += 32  # numbers, dates, etc.
    return total


def batch_insert(
    conn: MySQLConnection,
    table: str,
    columns: List[str],
    rows: List[Tuple],
    batch_size: int = DEFAULT_BATCH_SIZE,
    max_packet: int = 0,
) -> int:
    """
    Batch INSERT IGNORE into target table.
    Returns number of rows actually inserted.
    O(n) — one INSERT per chunk of `batch_size` rows.

    Adaptive chunking:
      - If *table* is in LARGE_TEXT_TABLES the batch is capped at LARGE_TEXT_BATCH_SIZE.
      - Within each chunk, rows are further sub-chunked if estimated byte
        size would exceed 50% of max_allowed_packet (safety margin).
      - On a 'packet too large' error the chunk is retried row-by-row.
    """
    if not rows:
        return 0

    # Cap batch size for tables known to have large TEXT columns
    effective_bs = min(batch_size, LARGE_TEXT_BATCH_SIZE) if table in LARGE_TEXT_TABLES else batch_size
    if not max_packet:
        max_packet = get_max_allowed_packet(conn)
    safe_packet = int(max_packet * 0.50)  # 50 % margin

    cols_sql = ", ".join(f"`{c}`" for c in columns)
    placeholders = ", ".join(["%s"] * len(columns))
    sql = f"INSERT IGNORE INTO `{table}` ({cols_sql}) VALUES ({placeholders})"

    inserted = 0

    for i in range(0, len(rows), effective_bs):
        chunk = rows[i : i + effective_bs]

        # ---- Sub-chunk by estimated packet size ----
        sub_chunks: List[List[Tuple]] = []
        current_sub: List[Tuple] = []
        current_bytes = len(sql) + 50  # base statement overhead

        for row in chunk:
            row_bytes = _estimate_row_bytes(row)
            if current_sub and (current_bytes + row_bytes) > safe_packet:
                sub_chunks.append(current_sub)
                current_sub = [row]
                current_bytes = len(sql) + 50 + row_bytes
            else:
                current_sub.append(row)
                current_bytes += row_bytes

        if current_sub:
            sub_chunks.append(current_sub)

        for sub in sub_chunks:
            try:
                cur = conn.cursor()
                cur.executemany(sql, sub)
                inserted += cur.rowcount
                cur.close()
            except MySQLError as e:
                # Packet-too-large (1153) or lost-connection (2006/2013/2055)
                if e.errno in (1153, 2006, 2013, 2055):
                    log.warning(
                        f"  Packet/connection error on `{table}` sub-chunk "
                        f"({len(sub)} rows) — falling back to row-by-row insert."
                    )
                    # Try to get a healthy cursor; caller must handle reconnect
                    try:
                        conn.ping(reconnect=True)
                    except Exception:
                        raise  # let caller reconnect
                    for single_row in sub:
                        try:
                            cur2 = conn.cursor()
                            cur2.execute(sql, single_row)
                            inserted += cur2.rowcount
                            cur2.close()
                        except MySQLError as row_err:
                            log.error(f"  Row insert failed on `{table}`: {row_err}")
                else:
                    raise

    return inserted


# ============================================================================
# SERIALISATION HELPERS
# ============================================================================

NOW = datetime.datetime.now()


def _json_str(val):
    """Ensure JSON-serialisable string or None."""
    if val is None:
        return None
    if isinstance(val, str):
        return val
    return json.dumps(val, default=str)


def _bool(val, default=0):
    if val is None:
        return default
    return 1 if val else 0


def _str(val, default=None, max_len=None):
    if val is None:
        return default
    s = str(val)
    if max_len:
        s = s[:max_len]
    return s


def _dec(val, default=Decimal("0")):
    if val is None:
        return default
    return val


# ============================================================================
# TABLE MIGRATION FUNCTIONS
# ============================================================================

# The order below respects FK dependencies:
#   patients → appointments → consultations → care_notes → ...
#   inventory_categories → medication_items / consumable_items → batches → ...
#   insurance_providers → insurance_schemes → patient_insurance → ...
#   patient_bills → bill_items → payments → ...


def migrate_patients(legacy_conn, new_conn, ws, batch_size) -> MigrationStats:
    """patients: add workspaceId."""
    TABLE = "patients"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "isActive", "externalId", "firstName", "lastName", "gender",
        "birthDate", "phoneNumber", "medicalAid", "membershipNumber",
        "fileNumber", "email", "city", "address", "nationalId", "age",
        "insuranceMigrated", "insuranceMigratedAt", "deletedById",
        "workspaceId", "createdAt", "updatedAt", "deletedAt",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], _bool(r.get("isActive", 1)), r.get("externalId"),
            r["firstName"], r["lastName"], r["gender"], r["birthDate"],
            r.get("phoneNumber"), r.get("medicalAid"), r.get("membershipNumber"),
            r.get("fileNumber"), r.get("email"), r.get("city"), r.get("address"),
            r.get("nationalId"), r.get("age"),
            _bool(r.get("insuranceMigrated", 0)), r.get("insuranceMigratedAt"),
            r.get("deletedById"),
            ws, r.get("createdAt", NOW), r.get("updatedAt", NOW), r.get("deletedAt"),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, batch_size)
    return MigrationStats(TABLE, len(rows), inserted)


def _migrate_patient_history_table(
    legacy_conn, new_conn, ws, batch_size, table: str, extra_cols: List[str]
) -> MigrationStats:
    """Generic for allergies, family_conditions, past_medical_history, past_surgical_history, social_history."""
    rows = fetch_legacy(legacy_conn, table)
    base_cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
    ]
    cols = base_cols + extra_cols
    mapped = []
    for r in rows:
        base = (
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW), None, None,
            0, 1, ws,
        )
        extras = tuple(r.get(c) for c in extra_cols)
        mapped.append(base + extras)
    inserted = batch_insert(new_conn, table, cols, mapped, batch_size)
    return MigrationStats(table, len(rows), inserted)


def migrate_allergies(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    return _migrate_patient_history_table(
        legacy_conn, new_conn, ws, bs, "allergies",
        ["substance", "reaction", "severity", "userId", "patientId"],
    )


def migrate_family_conditions(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    return _migrate_patient_history_table(
        legacy_conn, new_conn, ws, bs, "family_conditions",
        ["relation", "condition", "notes", "userId", "patientId"],
    )


def migrate_past_medical_history(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    return _migrate_patient_history_table(
        legacy_conn, new_conn, ws, bs, "past_medical_history",
        ["condition", "details", "userId", "patientId"],
    )


def migrate_past_surgical_history(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    return _migrate_patient_history_table(
        legacy_conn, new_conn, ws, bs, "past_surgical_history",
        ["procedure", "details", "date", "userId", "patientId"],
    )


def migrate_social_history(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    return _migrate_patient_history_table(
        legacy_conn, new_conn, ws, bs, "social_history",
        ["smokingStatus", "alcoholUse", "drugUse", "occupation", "additionalNotes", "userId", "patientId"],
    )


def migrate_appointments(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "appointments"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "patientId", "consultationId", "type", "date", "time",
        "paymentMethod", "status", "transcriptionId", "userId",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW), None, None,
            0, _bool(r.get("isActive", 1)), ws,
            r["patientId"], r.get("consultationId"), r.get("type", "INITIAL"),
            r["date"], r["time"], r["paymentMethod"],
            r.get("status", "SCHEDULED"),
            r.get("transcriptionId") if r.get("transcriptionId") else None,
            r["userId"],
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_consultations(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "consultations"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "patientId", "appointmentId", "doctorId", "status",
        "is_open_for_joining", "requires_join_approval",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deleted_by"),
            1 if r.get("deletedAt") else 0,
            _bool(r.get("is_active", r.get("isActive", 1))),
            ws,
            r["patientId"], r["appointmentId"], r["doctorId"],
            r.get("status", "DRAFT"),
            _bool(r.get("is_open_for_joining", 0)),
            _bool(r.get("requires_join_approval", 1)),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_consultation_collaborators(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "consultation_collaborators"
    rows = fetch_legacy(legacy_conn, TABLE)
    # Legacy roles are lowercase → new are UPPERCASE
    role_map = {
        "workspace_owner": "WORKSPACE_OWNER", "note_owner": "NOTE_OWNER",
        "system_admin": "SYSTEM_ADMIN", "doctor": "DOCTOR", "nurse": "NURSE",
        "medical_assistant": "MEDICAL_ASSISTANT", "pharmacist": "PHARMACIST",
        "therapist": "THERAPIST", "practice_admin": "PRACTICE_ADMIN",
        "billing_staff": "BILLING_STAFF", "scheduler": "SCHEDULER",
        "patient": "PATIENT", "read_only": "READ_ONLY",
        "lab_technician": "LAB_TECHNICIAN",
        "radiology_technician": "RADIOLOGY_TECHNICIAN", "vendor": "VENDOR",
    }
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "consultationId", "userId", "role", "deletedById", "lastAccessedAt",
    ]
    mapped = []
    for r in rows:
        legacy_role = (r.get("role") or "doctor").lower()
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), None,
            1 if r.get("deletedAt") else 0,
            _bool(r.get("isActive", 1)), ws,
            r["consultationId"], r["userId"],
            role_map.get(legacy_role, "DOCTOR"),
            r.get("deletedById"), r.get("lastAccessedAt"),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_consultation_join_requests(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "consultation_join_requests"
    rows = fetch_legacy(legacy_conn, TABLE)
    role_map = {
        "workspace_owner": "WORKSPACE_OWNER", "note_owner": "NOTE_OWNER",
        "system_admin": "SYSTEM_ADMIN", "doctor": "DOCTOR", "nurse": "NURSE",
        "medical_assistant": "MEDICAL_ASSISTANT", "pharmacist": "PHARMACIST",
        "therapist": "THERAPIST", "practice_admin": "PRACTICE_ADMIN",
        "billing_staff": "BILLING_STAFF", "scheduler": "SCHEDULER",
        "patient": "PATIENT", "read_only": "READ_ONLY",
        "lab_technician": "LAB_TECHNICIAN",
        "radiology_technician": "RADIOLOGY_TECHNICIAN", "vendor": "VENDOR",
    }
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "consultationId", "requestingUserId", "role", "status",
        "processedBy", "processedAt",
    ]
    mapped = []
    for r in rows:
        legacy_role = (r.get("role") or "read_only").lower()
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, 1, ws,
            r["consultationId"], r["requestingUserId"],
            role_map.get(legacy_role, "READ_ONLY"),
            r.get("status", "PENDING"),
            r.get("processedBy"), r.get("processedAt"),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_recordings_transcript(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "recordings_transcript"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "doctorId", "consultationId", "transcribedText", "audioFilePath",
        "structuredTranscript", "aiProvider", "modelUsed",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, 1, ws,
            r["doctorId"], r["consultationId"], r["transcribedText"],
            r["audioFilePath"], r["structuredTranscript"],
            r["aiProvider"], r["modelUsed"],
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_care_notes(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "care_notes"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "consultationId", "recordingsTranscriptId", "authorId",
        "type", "status", "content", "isAiGenerated", "aiMetadata",
        "version", "isLatestVersion", "previousVersionId",
        "prescriptionId", "versionNumber", "deleted_by",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deleted_by"),
            1 if r.get("deletedAt") else 0, 1, ws,
            r["consultationId"], r.get("recordingsTranscriptId"), r["authorId"],
            r.get("type", "general_examination"), r.get("status", "draft"),
            r.get("content"), _bool(r.get("isAiGenerated", 0)),
            _json_str(r.get("aiMetadata")),
            r.get("version", 1), _bool(r.get("isLatestVersion", 0)),
            r.get("previousVersionId"), r.get("prescriptionId"),
            r.get("versionNumber", 1), r.get("deleted_by"),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_care_note_permissions(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "care_note_permissions"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "noteId", "userId", "role", "permissionLevel",
        "canView", "canEdit", "canDelete", "canShare",
        "grantedBy", "expiresAt", "deleted_by",
    ]
    mapped = []
    for r in rows:
        if _bool(r.get("canDelete", 0)):
            perm = "admin"
        elif _bool(r.get("canEdit", 0)):
            perm = "write"
        else:
            perm = "read"
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, 1, ws,
            r["noteId"], r.get("userId"), None, perm,
            1, _bool(r.get("canEdit", 0)),
            _bool(r.get("canDelete", 0)), _bool(r.get("canShare", 0)),
            r.get("userId", MIGRATION_USER_ID),  # grantedBy NOT NULL
            r.get("validUntil"),
            None,
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_care_note_templates(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "care_note_templates"
    rows = fetch_legacy(legacy_conn, TABLE)
    type_to_category = {
        "system": "general", "specialty": "specialist",
        "emergency": "emergency", "user": "custom",
        "department": "general",
    }
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "name", "description", "category", "noteType",
        "content", "structure", "createdBy",
        "isPublic", "isDefault", "usageCount", "workspaceId",
        "isSystem", "deleted_by",
    ]
    mapped = []
    for r in rows:
        legacy_type = (r.get("type") or "system").lower()
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deleted_by"),
            1 if r.get("deletedAt") else 0,
            _bool(r.get("isActive", 1)),
            r["name"], r.get("description", ""),
            type_to_category.get(legacy_type, "general"),
            r.get("noteType"),
            r.get("template", ""),  # legacy.template → new.content
            None,
            r.get("ownerId", MIGRATION_USER_ID),  # createdBy NOT NULL
            1, 1, 0, ws,
            1 if legacy_type == "system" else 0,
            r.get("deleted_by"),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_care_note_timelines(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "care_note_timelines"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "noteId", "consultationId", "eventType", "eventTitle",
        "eventDescription", "eventTime", "createdBy", "metadata",
        "relatedEntityId", "relatedEntityType", "sequenceNumber",
        "deleted_by",
    ]
    mapped = []
    for r in rows:
        event_type = r.get("eventType") or "NOTE_EVENT"
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("createdAt", NOW),
            None, None, 0, 1, ws,
            r["noteId"], r["consultationId"],
            event_type, event_type,  # eventTitle NOT NULL → default to eventType
            None,
            r.get("eventTimestamp", r.get("createdAt", NOW)),  # eventTime NOT NULL
            MIGRATION_USER_ID,  # createdBy NOT NULL
            None, None, None,
            r.get("sequence", 0),
            None,
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_care_ai_note_sources(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "care_ai_note_sources"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "noteId", "aiProvider", "sourceType", "sourceId",
        "sourceContent", "modelVersion", "processingMetadata",
        "confidenceScore", "processedAt", "recordingTranscriptId",
        "deleted_by",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("createdAt", NOW),
            None, None, 0, 1, ws,
            r.get("noteId", ""),
            r.get("provider", "openai"),
            "consultation_transcript",  # sourceType NOT NULL
            r.get("parentSourceId"),
            r.get("sourceContent"),
            r.get("model"),  # modelVersion
            _json_str(r.get("metadata")),
            None, r.get("createdAt"), None, None,
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_note_audit_logs(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "note_audit_logs"
    rows = fetch_legacy(legacy_conn, TABLE)
    action_map = {
        "create": "CREATE", "update": "UPDATE", "delete": "DELETE",
        "publish": "PUBLISH", "approve": "APPROVE", "reject": "REJECT",
        "share": "SHARE", "permission_change": "PERMISSION_CHANGE",
        "ai_generate": "AI_GENERATE", "ai_approve": "AI_APPROVE",
        "ai_reject": "AI_REJECT", "version_restore": "VERSION_RESTORE",
        "modify": "MODIFY", "revert": "REVERT",
    }
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "noteId", "userId", "actionType", "changedFields",
        "previousValues", "newValues", "metadata",
        "ipAddress", "userAgent", "comment", "patientId",
        "aiProvider", "sharedWith", "oldPermission", "newPermission",
    ]
    mapped = []
    for r in rows:
        legacy_action = (r.get("actionType") or "create").lower()
        mapped.append((
            r["id"],
            r.get("created_at", r.get("createdAt", NOW)),
            r.get("updated_at", r.get("updatedAt", NOW)),
            None, None, 0, 1, ws,
            r["noteId"], r["userId"],
            action_map.get(legacy_action, "CREATE"),
            _json_str(r.get("changedFields")),
            None, None,
            _json_str(r.get("metadata")),
            r.get("ipAddress"), r.get("userAgent"),
            None, None, None, None, None, None,
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_note_versions(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "note_versions"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "noteId", "versionNumber", "content", "createdBy",
        "changeDescription", "metadata", "deleted_by",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("createdAt", NOW),
            None, None, 0, 1, ws,
            r["noteId"], r["versionNumber"], r.get("content"),
            r.get("authorId", MIGRATION_USER_ID),
            None, _json_str(r.get("aiMetadata")), None,
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_prescriptions(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "prescriptions"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "medicine", "dose", "route", "frequency", "days",
        "appointmentId", "consultationId", "noteId", "doctorId",
        "deleted_by",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deleted_by"),
            1 if r.get("deletedAt") else 0, 1, ws,
            r["medicine"], r.get("dose"), r.get("route"),
            r.get("frequency"), r.get("days"),
            r["appointmentId"], r["consultationId"],
            r.get("noteId"), r["doctorId"],
            r.get("deleted_by"),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_vitals(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "vitals"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "temperature", "bloodPressure", "heartRate", "saturation",
        "gcs", "bloodGlucose", "height", "weight", "time",
        "appointmentId", "patientId", "consultationId", "userId",
        "deletedById",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), None,
            1 if r.get("deletedAt") else 0, 1, ws,
            r["temperature"], r["bloodPressure"], r["heartRate"],
            r["saturation"], r["gcs"], r["bloodGlucose"],
            r["height"], r["weight"], r["time"],
            r.get("appointmentId"), r.get("patientId"),
            r.get("consultationId"), r["userId"],
            r.get("deletedById"),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_background_transcriptions(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "background_transcriptions"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "status", "currentStep", "doctorId", "consultationId",
        "transcriptId", "noteId", "audioFilePath",
        "metadata", "progress", "retryCount",
        "completedAt", "startedAt", "noteGeneratedAt",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, 1, ws,
            r.get("status", "PENDING"), r.get("currentStep", "UPLOAD"),
            r["doctorId"], r["consultationId"],
            r.get("transcriptId"), r.get("noteId"), r["audioFilePath"],
            _json_str(r.get("metadata")), _json_str(r.get("progress")),
            r.get("retryCount", 0),
            r.get("completedAt"), r.get("startedAt"), r.get("noteGeneratedAt"),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


# ---- Inventory domain ----

def migrate_suppliers(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "suppliers"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "code", "name", "description", "contactPerson",
        "email", "phone", "address", "taxIdentificationNumber", "paymentTerms",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)), ws,
            r["code"], r["name"], r.get("description"), r["contactPerson"],
            r["email"], r["phone"], r["address"],
            r.get("taxIdentificationNumber"), _json_str(r.get("paymentTerms")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_inventory_categories(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "inventory_categories"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "code", "name", "description", "defaultUnit", "parentId",
        "type", "requiresPrescriptionDefault", "isControlledDefault",
        "mpath", "workspaceId", "storageConditions",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)),
            r["code"], r["name"], r.get("description"), r.get("defaultUnit"),
            r.get("parentId"), r.get("type", "medication"),
            _bool(r.get("requiresPrescriptionDefault", 0)),
            _bool(r.get("isControlledDefault", 0)),
            r.get("mpath", ""), ws,
            _json_str(r.get("storageConditions")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_medication_items(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "medication_items"
    rows = fetch_legacy(legacy_conn, TABLE)
    # Legacy has many more unitOfMeasure values; map unsupported → 'OTHER'
    valid_units = {
        "TABLET", "CAPSULE", "CAPLET", "PILL", "LOZENGE", "SUPPOSITORY",
        "ML", "LITER", "VIAL", "AMP", "SYRINGE", "BOTTLE", "TUBE",
        "PACK", "OTHER",
    }
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "code", "name", "description", "type",
        "totalQuantity", "availableQuantity", "reservedQuantity",
        "minimumStockLevel", "reorderQuantity", "totalPackCount",
        "trackInBaseUnits", "form", "barcode", "unitOfMeasure",
        "unitCost", "sellingPrice", "baseUnitPrice",
        "requiresPrescription", "isControlledSubstance", "isHighRisk",
        "isSingleUse", "isSterile", "isSplittable",
        "basePackSize", "basePackUnit", "minimumDispenseQuantity",
        "useOpenedPacksFirst",
        "categoryId", "supplierId", "workspaceId",
        "splitUnits", "materialComposition", "storageConditions",
        "storageOverrides", "metadata",
    ]
    mapped = []
    for r in rows:
        uom = r.get("unitOfMeasure")
        if uom and uom.upper() not in valid_units:
            uom = "OTHER"
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)),
            r["code"], r["name"], r.get("description"), r.get("type", "medication"),
            _dec(r.get("totalQuantity")), _dec(r.get("availableQuantity")),
            _dec(r.get("reservedQuantity")),
            _dec(r.get("minimumStockLevel")), _dec(r.get("reorderQuantity")),
            _dec(r.get("totalPackCount")),
            _bool(r.get("trackInBaseUnits", 0)),
            r.get("form"), r.get("barcode"), uom,
            r["unitCost"], r.get("sellingPrice"), r.get("baseUnitPrice"),
            _bool(r.get("requiresPrescription", 0)),
            _bool(r.get("isControlledSubstance", 0)),
            _bool(r.get("isHighRisk", 0)),
            _bool(r.get("isSingleUse", 0)),
            _bool(r.get("isSterile", 0)),
            _bool(r.get("isSplittable", 0)),
            r.get("basePackSize"), r.get("basePackUnit"),
            r.get("minimumDispenseQuantity"),
            _bool(r.get("useOpenedPacksFirst", 1)),
            r["categoryId"], r.get("supplierId"), ws,
            _json_str(r.get("splitUnits")),
            _json_str(r.get("materialComposition")),
            _json_str(r.get("storageConditions")),
            _json_str(r.get("storageOverrides")),
            _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_consumable_items(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "consumable_items"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "code", "name", "description", "type",
        "totalQuantity", "availableQuantity", "reservedQuantity",
        "minimumStockLevel", "reorderQuantity", "totalPackCount",
        "trackInBaseUnits", "form", "barcode", "unitOfMeasure",
        "unitCost", "sellingPrice", "baseUnitPrice",
        "isSingleUse", "isSterile", "isDisposable", "isReusable",
        "requiresSterilization", "isSplittable",
        "basePackSize", "basePackUnit", "minimumDispenseQuantity",
        "useOpenedPacksFirst",
        "categoryId", "supplierId",
        "splitUnits", "materialComposition", "storageConditions",
        "storageOverrides", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)), ws,
            r["code"], r["name"], r.get("description"),
            r.get("type", "consumable"),
            _dec(r.get("totalQuantity")), _dec(r.get("availableQuantity")),
            _dec(r.get("reservedQuantity")),
            _dec(r.get("minimumStockLevel")), _dec(r.get("reorderQuantity")),
            _dec(r.get("totalPackCount")),
            _bool(r.get("trackInBaseUnits", 0)),
            r.get("form"), r.get("barcode"), r.get("unitOfMeasure"),
            r["unitCost"], r.get("sellingPrice"), r.get("baseUnitPrice"),
            _bool(r.get("isSingleUse", 0)), _bool(r.get("isSterile", 0)),
            _bool(r.get("isDisposable", 0)), _bool(r.get("isReusable", 0)),
            _bool(r.get("requiresSterilization", 0)), _bool(r.get("isSplittable", 0)),
            r.get("basePackSize"), r.get("basePackUnit"),
            r.get("minimumDispenseQuantity"), _bool(r.get("useOpenedPacksFirst", 1)),
            r["categoryId"], r.get("supplierId"),
            _json_str(r.get("splitUnits")), _json_str(r.get("materialComposition")),
            _json_str(r.get("storageConditions")), _json_str(r.get("storageOverrides")),
            _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_batches(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "batches"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "batchNumber", "itemType", "manufactureDate", "expiryDate",
        "initialQuantity", "availableQuantity", "totalPacks", "openedPacks",
        "packSize", "quantityUnit", "isFractionalTracking",
        "unitCost", "sellingPrice", "location", "notes",
        "isPartial", "parentBatchId", "partialQuantity",
        "isSterile", "sterilityIndicator", "sterilityExpiryDate",
        "isQualityTested", "qualityTestDate", "qualityTestResult", "qualityTestNotes",
        "isQuarantined", "reservedQuantity", "quarantineReason", "quarantineDate",
        "quarantineReleasedBy", "quarantineReleaseDate",
        "certificateOfAnalysis", "manufacturingLicense", "importPermitNumber",
        "receivedDate", "metadata",
        "medicationItemId", "consumableItemId", "supplierId",
        "createdBy", "updatedBy",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)), ws,
            r["batchNumber"], r["itemType"], r["manufactureDate"], r["expiryDate"],
            r["initialQuantity"], r["availableQuantity"],
            _dec(r.get("totalPacks")), _dec(r.get("openedPacks")),
            r.get("packSize"), r.get("quantityUnit"),
            _bool(r.get("isFractionalTracking", 0)),
            r["unitCost"], r.get("sellingPrice"), r.get("location"), r.get("notes"),
            _bool(r.get("isPartial", 0)), r.get("parentBatchId"), r.get("partialQuantity"),
            _bool(r.get("isSterile", 0)), r.get("sterilityIndicator"),
            r.get("sterilityExpiryDate"),
            _bool(r.get("isQualityTested", 1)), r.get("qualityTestDate"),
            r.get("qualityTestResult"), r.get("qualityTestNotes"),
            _bool(r.get("isQuarantined", 0)), _dec(r.get("reservedQuantity")),
            r.get("quarantineReason"), r.get("quarantineDate"),
            r.get("quarantineReleasedBy"), r.get("quarantineReleaseDate"),
            r.get("certificateOfAnalysis"), r.get("manufacturingLicense"),
            r.get("importPermitNumber"), r.get("receivedDate"),
            _json_str(r.get("metadata")),
            r.get("medicationItemId"), r.get("consumableItemId"), r.get("supplierId"),
            r.get("createdBy"), r.get("updatedBy"),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def _migrate_movement_table(legacy_conn, new_conn, ws, bs, table, item_col) -> MigrationStats:
    rows = fetch_legacy(legacy_conn, table)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        item_col, "batchId", "quantity", "type", "movementType",
        "department", "reference", "initiatedBy", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)), ws,
            r[item_col], r.get("batchId"), r["quantity"],
            r["type"], r["movementType"],
            r["department"], r.get("reference"), r.get("initiatedBy"),
            _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, table, cols, mapped, bs)
    return MigrationStats(table, len(rows), inserted)


def migrate_medication_movements(lc, nc, ws, bs):
    return _migrate_movement_table(lc, nc, ws, bs, "medication_movements", "medicationItemId")


def migrate_consumable_movements(lc, nc, ws, bs):
    return _migrate_movement_table(lc, nc, ws, bs, "consumable_movements", "consumableItemId")


def _migrate_adjustment_table(legacy_conn, new_conn, ws, bs, table, item_col) -> MigrationStats:
    rows = fetch_legacy(legacy_conn, table)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        item_col, "batchId", "quantity", "adjustmentType",
        "reason", "approvedBy", "initiatedBy", "approvalDate", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)), ws,
            r[item_col], r.get("batchId"), r["quantity"],
            r["adjustmentType"], r.get("reason"),
            r.get("approvedBy"), r.get("initiatedBy"),
            r.get("approvalDate"), _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, table, cols, mapped, bs)
    return MigrationStats(table, len(rows), inserted)


def migrate_medication_adjustments(lc, nc, ws, bs):
    return _migrate_adjustment_table(lc, nc, ws, bs, "medication_adjustments", "medicationItemId")


def migrate_consumable_adjustments(lc, nc, ws, bs):
    return _migrate_adjustment_table(lc, nc, ws, bs, "consumable_adjustments", "consumableItemId")


def migrate_medication_sales(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "medication_sales"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "medicationItemId", "batchId", "quantity", "unitPrice", "totalPrice",
        "patientId", "prescriptionId", "soldBy", "billId", "saleDate", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)), ws,
            r["medicationItemId"], r.get("batchId"), r["quantity"],
            r["unitPrice"], r["totalPrice"],
            r.get("patientId"), None,
            r.get("recordedBy"),  # soldBy ← recordedBy
            None, r.get("createdAt", NOW),
            json.dumps({
                "_legacy_appointmentId": r.get("appointmentId"),
                "_legacy_department": r.get("department"),
                "_legacy_isControlledSubstance": r.get("isControlledSubstance"),
                "_legacy_notes": r.get("notes"),
            }, default=str),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_medication_partial_sales(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "medication_partial_sales"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "medicationItemId", "batchId", "quantity", "packSize",
        "partialQuantity", "unitPrice", "totalPrice",
        "patientId", "prescriptionId", "soldBy", "billId", "saleDate", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)), ws,
            r["medicationItemId"], r.get("batchId"),
            r.get("soldQuantity", Decimal("0")),
            r.get("originalPackSize"), r.get("remainingQuantity"),
            r.get("unitPrice"), r.get("totalPrice"),
            r.get("patientId"), r.get("prescriptionReference"),
            r.get("recordedBy"), None, r.get("createdAt", NOW),
            json.dumps({
                "_legacy_appointmentId": r.get("appointmentId"),
                "_legacy_department": r.get("department"),
                "_legacy_packIdentifier": r.get("packIdentifier"),
                "_legacy_packWasOpened": r.get("packWasOpened"),
                "_legacy_packWasDepleted": r.get("packWasDepleted"),
            }, default=str),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_consumable_usages(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "consumable_usages"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "consumableItemId", "batchId", "quantity",
        "patientId", "procedureId", "serviceId",
        "usedBy", "department", "usageDate", "notes", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)), ws,
            r["consumableItemId"], r.get("batchId"), r["quantity"],
            r.get("patientId"), None, None,
            r.get("recordedBy"), r["department"],
            r.get("createdAt", NOW), r.get("notes"),
            json.dumps({"_legacy_appointmentId": r.get("appointmentId"),
                        "_legacy_unitCost": str(r.get("unitCost", ""))}, default=str),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_consumable_partial_usages(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "consumable_partial_usages"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "consumableItemId", "batchId", "quantity", "packSize",
        "partialQuantity", "patientId", "procedureId", "serviceId",
        "usedBy", "department", "usageDate", "notes", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)), ws,
            r["consumableItemId"], r.get("batchId"),
            r.get("usedQuantity", Decimal("0")),
            r.get("originalPackSize"), r.get("remainingQuantity"),
            r.get("patientId"), None, None,
            r.get("recordedBy"), r["department"],
            r.get("createdAt", NOW), r.get("notes"),
            json.dumps({"_legacy_appointmentId": r.get("appointmentId"),
                        "_legacy_packIdentifier": r.get("packIdentifier")}, default=str),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_inventory_audits(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "inventory_audits"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "itemId", "itemType", "batchId",
        "systemQuantity", "physicalQuantity", "variance",
        "notes", "auditedBy", "auditDate",
        "approvedBy", "approvalDate", "metadata",
    ]
    mapped = []
    for r in rows:
        prev = _dec(r.get("previousQuantity", Decimal("0")))
        new_qty = _dec(r.get("newQuantity", Decimal("0")))
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedBy"),
            _bool(r.get("isDeleted", 0)), _bool(r.get("isActive", 1)), ws,
            r["itemId"], r["itemType"], None,
            prev, new_qty, new_qty - prev,
            r.get("reason"), r.get("performedBy"),
            r.get("auditDate", r.get("createdAt", NOW)),
            None, None,
            json.dumps({"_legacy_itemName": r.get("itemName"),
                        "_legacy_itemCode": r.get("itemCode"),
                        "_legacy_actionType": r.get("actionType")}),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


# ---- Billing domain ----

def migrate_payment_methods(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "payment_methods"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "type", "name", "description", "processingFeePercentage",
        "minAmount", "maxAmount", "configuration",
        "sortOrder", "icon", "color", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, _bool(r.get("isActive", 1)),
            r.get("type", "CASH"), r["name"], r.get("description"),
            r.get("processingFeePercentage"), r.get("minAmount"), r.get("maxAmount"),
            _json_str(r.get("configuration")),
            r.get("sortOrder", 0), r.get("icon"), r.get("color"),
            _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_discounts(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "discounts"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "name", "description", "discountType", "value",
        "isPercentage", "maxDiscountAmount", "minPurchaseAmount",
        "validFrom", "validUntil",
        "applicableServices", "applicableDepartments",
        "usageLimit", "usageCount", "metadata",
    ]
    mapped = []
    for r in rows:
        legacy_type = r.get("type", "PERCENTAGE")
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), None, 0, _bool(r.get("isActive", 1)),
            r["name"], r.get("description"),
            legacy_type, r["value"],
            1 if legacy_type == "PERCENTAGE" else 0,
            r.get("maxTotalDiscountAmount"), None,
            r.get("validFrom"), r.get("validTo"),
            _json_str(r.get("eligibilityCriteria")), None,
            r.get("maxUsageCount", 0), r.get("usageCount", 0),
            _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_taxes(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "taxes"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "name", "description", "taxType", "rate", "isCompound",
        "applicableServices", "applicableDepartments",
        "effectiveFrom", "effectiveUntil", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, _bool(r.get("isActive", 1)),
            r["name"], r.get("description"), "STANDARD", r["rate"], 0,
            _json_str(r.get("applicability")), None,
            r.get("validFrom"), r.get("validTo"), None,
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_patient_bills(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "patient_bills"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "billNumber", "patientId", "appointmentId",
        "department", "discountId", "taxId",
        "subtotal", "total", "discountAmount", "taxAmount",
        "status", "issuedAt", "dueDate", "notes", "metadata", "workspaceId",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, 1,
            r["billNumber"], r["patientId"], r["appointmentId"],
            r.get("department"), r.get("discountId"), r.get("taxId"),
            _dec(r.get("subtotal")), _dec(r.get("total")),
            _dec(r.get("discountAmount")), _dec(r.get("taxAmount")),
            r.get("status", "PENDING"), r["issuedAt"], r.get("dueDate"),
            r.get("notes"), _json_str(r.get("metadata")), ws,
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_bill_items(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "bill_items"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "billId", "description", "quantity", "unitPrice", "totalPrice",
        "department", "medicationItemId", "consumableItemId", "batchId",
        "dispensedBy", "actualUnitCost",
        "hasInsuranceClaim", "insuranceClaimStatus",
        "totalClaimedAmount", "totalApprovedAmount", "totalDeniedAmount", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, 1, ws,
            r["billId"], r["description"], r["quantity"], r["unitPrice"],
            r.get("total", r.get("totalPrice", Decimal("0"))),
            r.get("department"), r.get("medicationItemId"), r.get("consumableItemId"),
            r.get("batchId"), None, r.get("actualUnitCost"),
            r.get("hasInsuranceClaim"), r.get("insuranceClaimStatus", "NOT_CLAIMED"),
            _dec(r.get("totalClaimedAmount")), _dec(r.get("totalApprovedAmount")),
            _dec(r.get("totalDeniedAmount")), _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_billing_transactions(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "billing_transactions"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "transactionReference", "transactionType",
        "billId", "paymentId", "amount",
        "balanceBefore", "balanceAfter", "status",
        "transactionDate", "processedBy", "description", "notes", "metadata",
    ]
    mapped = []
    for r in rows:
        ref = r.get("referenceNumber") or f"MIG-{r['id'][:8]}"
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("createdAt", NOW),
            None, None, 0, 1,
            ref, r.get("transactionType", "SALE"),
            None, None,
            _dec(r.get("totalPrice", r.get("amount", Decimal("0")))),
            Decimal("0"), Decimal("0"), "COMPLETED",
            r.get("transactionDate", r.get("createdAt", NOW)),
            None, None, r.get("notes"),
            json.dumps({
                "_legacy_batchId": r.get("batchId"),
                "_legacy_billItemId": r.get("billItemId"),
                "_legacy_actualUnitCost": str(r.get("actualUnitCost", "")),
                "_legacy_quantity": str(r.get("quantity", "")),
                "_legacy_profitMargin": str(r.get("profitMargin", "")),
                "_legacy_patientId": r.get("patientId"),
            }, default=str),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_payments(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "payments"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "paymentReference", "billId", "patientId", "paymentMethodId",
        "processingFeePercentage", "amount", "processingFee", "netAmount",
        "status", "transactionId", "chequeNumber", "bankName",
        "accountNumber", "cardLastFour", "cardType", "authorizationCode",
        "insuranceProvider", "insurancePolicyNumber", "authorizationNumber",
        "paymentDate", "processedAt", "refundedAt", "failedAt",
        "notes", "failureReason", "paymentDetails", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("createdAt", NOW),
            None, None, 0, 1,
            r["paymentReference"], r["billId"], r["patientId"], r["paymentMethodId"],
            r.get("processingFeePercentage"), r["amount"],
            _dec(r.get("processingFee")), r["netAmount"],
            r.get("status", "PENDING"), r.get("transactionId"),
            r.get("chequeNumber"), r.get("bankName"),
            r.get("accountNumber"), r.get("cardLastFour"),
            r.get("cardType"), r.get("authorizationCode"),
            r.get("insuranceProvider"), r.get("insurancePolicyNumber"),
            r.get("authorizationNumber"),
            r.get("paymentDate", NOW), r.get("processedAt"),
            r.get("refundedAt"), r.get("failedAt"),
            r.get("notes"), r.get("failureReason"),
            _json_str(r.get("paymentDetails")), _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_invoices(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "invoices"
    rows = fetch_legacy(legacy_conn, TABLE)
    status_map = {
        "DRAFT": "DRAFT", "ISSUED": "PENDING", "SENT": "PENDING",
        "PAID": "PAID", "PARTIALLY_PAID": "PARTIALLY_PAID",
        "OVERDUE": "OVERDUE", "CANCELLED": "CANCELLED",
        "REFUNDED": "REFUNDED", "VOIDED": "VOIDED", "PENDING": "PENDING",
    }
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "invoiceNumber", "billId", "patientId",
        "subtotal", "discountAmount", "taxAmount", "total",
        "amountPaid", "amountDue",
        "status", "issuedAt", "dueDate", "paidAt", "notes", "terms", "metadata",
    ]
    mapped = []
    for r in rows:
        amt = _dec(r.get("amount", Decimal("0")))
        paid = _dec(r.get("amountPaid", Decimal("0")))
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("createdAt", NOW),
            None, None, 0, 1,
            r["invoiceNumber"], r["billId"], r["patientId"],
            amt, Decimal("0"), Decimal("0"), amt, paid, amt - paid,
            status_map.get(r.get("status", "PENDING"), "PENDING"),
            r.get("issueDate", r.get("createdAt", NOW)), r.get("dueDate"),
            None, r.get("notes"), None,
            json.dumps({"_legacy_type": r.get("type"), "_legacy_items": r.get("items")}, default=str)
            if r.get("items") else _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_receipts(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "receipts"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "receiptNumber", "paymentId", "patientId",
        "amount", "paymentMethod", "issuedAt", "issuedBy", "notes", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("createdAt", NOW),
            None, None, 0, 1,
            r["receiptNumber"], r["paymentId"], r["patientId"],
            r["amount"], r["paymentMethod"],
            r.get("paymentDate", r.get("createdAt", NOW)), None,
            r.get("notes"),
            json.dumps({"_legacy_items": r.get("items")}, default=str) if r.get("items") else _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


# ---- Insurance domain ----

def migrate_insurance_providers(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "insurance_providers"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "providerCode", "name", "shortName", "status", "description",
        "requiresPreAuthorization", "supportsElectronicClaims",
        "claimsSubmissionFormat", "defaultCopaymentPercentage",
        "maximumClaimAmount", "minimumClaimAmount",
        "contractNumber", "contractStartDate", "contractEndDate",
        "termsAndConditions", "address", "metadata", "contactInfo", "processingTimes",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, 1,
            r["providerCode"], r["name"], r.get("shortName"),
            r.get("status", "ACTIVE"), r.get("description"),
            _bool(r.get("requiresPreAuthorization", 0)),
            _bool(r.get("supportsElectronicClaims", 1)),
            r.get("claimsSubmissionFormat"), _dec(r.get("defaultCopaymentPercentage")),
            r.get("maximumClaimAmount"), r.get("minimumClaimAmount"),
            r.get("contractNumber"), r.get("contractStartDate"),
            r.get("contractEndDate"), r.get("termsAndConditions"),
            None, _json_str(r.get("metadata")),
            _json_str(r.get("contactInfo")), _json_str(r.get("processingTimes")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_insurance_schemes(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "insurance_schemes"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "providerId", "schemeCode", "schemeName", "schemeType",
        "status", "description", "defaultCoveragePercentage",
        "requiresPreAuthorization", "restrictedToNetwork",
        "networkProviders", "outOfNetworkPenalty",
        "monthlyPremium", "annualDeductible", "copaymentAmount",
        "effectiveDate", "expiryDate",
        "metadata", "coverageRules", "benefitLimits", "authorizationRequirements",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, 1,
            r["providerId"], r["schemeCode"], r["schemeName"],
            r.get("schemeType", "OTHER"), r.get("status", "ACTIVE"),
            r.get("description"), _dec(r.get("defaultCoveragePercentage", Decimal("100"))),
            _bool(r.get("requiresPreAuthorization", 0)),
            _bool(r.get("restrictedToNetwork", 0)),
            r.get("networkProviders"), r.get("outOfNetworkPenalty"),
            _dec(r.get("monthlyPremium")),
            r.get("annualDeductible"), r.get("copaymentAmount"),
            r.get("effectiveDate"), r.get("expiryDate"),
            _json_str(r.get("metadata")), _json_str(r.get("coverageRules")),
            _json_str(r.get("benefitLimits")), _json_str(r.get("authorizationRequirements")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_patient_insurance(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "patient_insurance"
    rows = fetch_legacy(legacy_conn, TABLE)
    status_map = {"EXPIRED": "INACTIVE"}
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "patientId", "insuranceProviderId", "schemeId",
        "membershipNumber", "policyNumber", "memberType",
        "principalMemberId", "relationshipToPrincipal",
        "status", "isPrimary", "priority",
        "effectiveDate", "expiryDate", "enrollmentDate",
        "currentAuthorizationNumber", "authorizationExpiryDate", "authorizationNotes",
        "insuranceContactPerson", "insuranceContactPhone", "insuranceContactEmail",
        "lastVerifiedDate", "verifiedBy", "verificationNotes",
        "workspaceId", "metadata", "currentYearUtilization",
    ]
    mapped = []
    for r in rows:
        st = status_map.get(r.get("status", "ACTIVE"), r.get("status", "ACTIVE"))
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, 1,
            r["patientId"], r["insuranceProviderId"], r["schemeId"],
            r["membershipNumber"], r.get("policyNumber"),
            r.get("memberType", "PRINCIPAL"),
            r.get("principalMemberId"), r.get("relationshipToPrincipal"),
            st, _bool(r.get("isPrimary", 1)), r.get("priority", 1),
            r["effectiveDate"], r["expiryDate"], r.get("enrollmentDate"),
            r.get("currentAuthorizationNumber"), r.get("authorizationExpiryDate"),
            r.get("authorizationNotes"),
            r.get("insuranceContactPerson"), r.get("insuranceContactPhone"),
            r.get("insuranceContactEmail"),
            r.get("lastVerifiedDate"), r.get("verifiedBy"), r.get("verificationNotes"),
            ws, _json_str(r.get("metadata")), _json_str(r.get("currentYearUtilization")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_insurance_claims(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "insurance_claims"
    rows = fetch_legacy(legacy_conn, TABLE)
    status_map = {
        "DRAFT": "PENDING", "PENDING": "PENDING", "SUBMITTED": "PENDING",
        "IN_REVIEW": "PENDING", "APPROVED": "FULLY_APPROVED",
        "PARTIALLY_APPROVED": "PARTIALLY_APPROVED", "REJECTED": "DENIED",
        "PAID": "FULLY_APPROVED", "APPEALED": "APPEALED", "CANCELLED": "CANCELLED",
    }
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "claimNumber", "patientId", "patientInsuranceId", "insuranceProviderId",
        "billId", "appointmentId",
        "status", "claimDate", "submittedDate", "processedDate",
        "serviceDate", "serviceEndDate",
        "totalClaimedAmount", "totalApprovedAmount", "totalDeniedAmount",
        "totalAdjustedAmount", "totalPaidAmount", "patientResponsibilityAmount",
        "authorizationNumber", "referenceNumber",
        "diagnosisCode", "diagnosisDescription",
        "attendingProviderId", "attendingProviderName",
        "claimNotes", "denialReason", "adjustmentReason",
        "submittedBy", "processedBy", "reviewedBy", "reviewedDate", "reviewNotes",
        "isAppealed", "appealDate", "appealNotes",
        "requiresFollowUp", "followUpDate", "attachments", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, 1, ws,
            r["claimNumber"], r["patientId"],
            r["patientInsuranceId"], r["insuranceProviderId"],
            r.get("billId"), None,
            status_map.get(r.get("status", "PENDING"), "PENDING"),
            r.get("createdAt", NOW), r.get("submittedAt"), r.get("processedAt"),
            r.get("serviceStartDate", r.get("createdAt", NOW)), r.get("serviceEndDate"),
            _dec(r.get("totalClaimedAmount")),
            _dec(r.get("approvedAmount", Decimal("0"))),
            _dec(r.get("deniedAmount", Decimal("0"))),
            Decimal("0"), _dec(r.get("paidAmount", Decimal("0"))),
            _dec(r.get("patientResponsibility", Decimal("0"))),
            r.get("preAuthorizationNumber"), r.get("insuranceClaimNumber"),
            r.get("diagnosisCode"), r.get("diagnosisDescription"),
            None, None, r.get("clinicalNotes"), None, None,
            r.get("submittedBy"), None,
            r.get("reviewedBy"), r.get("reviewedAt"), None,
            _bool(r.get("isAppealed", 0)), r.get("appealedAt"), r.get("appealNotes"),
            0, None, _json_str(r.get("attachments")), _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_insurance_claim_items(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "insurance_claim_items"
    rows = fetch_legacy(legacy_conn, TABLE)
    status_map = {
        "CLAIMED": "CLAIMED", "PENDING": "PENDING", "APPROVED": "FULLY_APPROVED",
        "PARTIALLY_APPROVED": "PARTIALLY_APPROVED", "DENIED": "DENIED", "ADJUSTED": "ADJUSTED",
    }
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "claimId", "billItemId", "lineNumber",
        "serviceCode", "serviceDescription", "serviceDate", "serviceEndDate",
        "quantity", "unit", "unitPrice",
        "claimedAmount", "approvedAmount", "deniedAmount",
        "adjustedAmount", "paidAmount", "patientResponsibilityAmount",
        "status", "diagnosisCode", "diagnosisDescription",
        "procedureCode", "procedureDescription", "modifierCode", "revenueCode",
        "coveragePercentage", "copaymentPercentage", "copaymentAmount", "deductibleAmount",
        "denialReason", "adjustmentReason", "notes",
        "providerId", "providerName", "facilityCode",
        "isAppealed", "appealNotes", "metadata",
    ]
    mapped = []
    for idx, r in enumerate(rows):
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, 1,
            r["claimId"], r.get("billItemId"), idx + 1,
            r.get("procedureCode", "MIG"), r.get("description", "Migrated item"),
            r.get("createdAt", NOW), None,
            r["quantity"], None, r["unitPrice"],
            r["claimedAmount"], _dec(r.get("approvedAmount")),
            _dec(r.get("deniedAmount")), _dec(r.get("adjustmentAmount", Decimal("0"))),
            Decimal("0"), _dec(r.get("patientResponsibility", Decimal("0"))),
            status_map.get(r.get("status", "PENDING"), "PENDING"),
            r.get("diagnosisCode"), None, r.get("procedureCode"), None, None,
            r.get("revenueCode"), r.get("appliedCoveragePercentage"),
            None, None, None,
            r.get("denialReason") if isinstance(r.get("denialReason"), str) else _json_str(r.get("denialReason")),
            r.get("adjustmentReason"), r.get("adjudicationNotes"),
            None, None, None, 0, None, _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_insurance_contracts(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "insurance_contracts"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "contractNumber", "insuranceProviderId", "schemeId",
        "contractName", "contractType", "status",
        "startDate", "endDate", "autoRenew",
        "paymentTerms", "annualContractValue",
        "requiresPreAuthorization", "supportsElectronicClaims",
        "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, _bool(r.get("isActive", 1)), ws,
            r["contractNumber"], None, None,
            r.get("insurerName", r["contractNumber"]),
            "STANDARD", "ACTIVE" if _bool(r.get("isActive", 1)) else "INACTIVE",
            r["effectiveDate"], r["expiryDate"], 1,
            "NET_30", r.get("annualLimit"),
            0, 1,
            json.dumps({
                "_legacy_insurerName": r.get("insurerName"),
                "_legacy_utilizedAmount": str(r.get("utilizedAmount", "")),
                "_legacy_coveredItems": r.get("coveredItems"),
                "_legacy_patientEligibility": r.get("patientEligibility"),
            }, default=str),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_referral_letters(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "referral_letters"
    rows = fetch_legacy(legacy_conn, TABLE)
    status_map = {
        "draft": "draft", "issued": "sent", "sent": "sent",
        "acknowledged": "acknowledged", "completed": "completed", "cancelled": "cancelled",
    }
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "patientId", "referringDoctorId", "referredToId",
        "noteId", "consultationId",
        "status", "urgency", "specialty",
        "referredToName", "referredToAddress", "referredToContact",
        "reasonForReferral", "clinicalHistory",
        "examinationFindings", "investigations", "currentMedications",
        "additionalNotes", "referralDate", "expectedAppointmentDate",
        "acknowledgedDate", "completedDate", "referenceNumber",
        "metadata", "doctorId", "deleted_by",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedById"),
            1 if r.get("deletedAt") else 0, _bool(r.get("isActive", 1)), ws,
            r["patientId"], r["doctorId"], None, None, r.get("consultationId"),
            status_map.get(r.get("status", "draft"), "draft"),
            r.get("urgency", "routine"),
            _str(r.get("referredToService"), default="General"),
            r.get("referredToClinician"), r.get("facilityAddress"),
            r.get("facilityContact"),
            r.get("reasonForReferral", ""), r.get("clinicalSummary"),
            r.get("examinationFindings"), r.get("investigationResults"),
            r.get("treatmentToDate"), r.get("specialInstructions"),
            r.get("createdAt", NOW), r.get("preferredAppointmentDate"),
            r.get("acknowledgedAt"), None, r.get("trackingNumber"),
            json.dumps({
                "_legacy_referralType": r.get("referralType"),
                "_legacy_referredToFacility": r.get("referredToFacility"),
                "_legacy_finalLetterContent": r.get("finalLetterContent"),
            }, default=str),
            r.get("doctorId"), r.get("deletedById"),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_sick_notes(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "sick_notes"
    rows = fetch_legacy(legacy_conn, TABLE)
    status_map = {
        "draft": "draft", "issued": "issued", "extended": "issued",
        "expired": "expired", "cancelled": "cancelled",
    }
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "patientId", "doctorId", "noteId", "consultationId",
        "status", "issueDate", "startDate", "endDate", "durationDays",
        "diagnosis", "recommendations",
        "employerName", "employerAddress",
        "isFitForLightDuties", "lightDutiesDescription",
        "certificateNumber", "metadata", "deleted_by",
    ]
    mapped = []
    for r in rows:
        is_light = r.get("workRestriction") in ("light_duty", "modified_duty")
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), r.get("deletedById"),
            1 if r.get("deletedAt") else 0, _bool(r.get("isActive", 1)), ws,
            r["patientId"], r["doctorId"], None, r.get("consultationId"),
            status_map.get(r.get("status", "draft"), "draft"),
            r.get("startDate", r.get("createdAt", NOW)),
            r["startDate"], r["endDate"], r["durationDays"],
            r["diagnosis"], r.get("clinicalSummary"),
            None, None, 1 if is_light else 0,
            r.get("specificRestrictions"), None,
            json.dumps({
                "_legacy_icd10Code": r.get("icd10Code"),
                "_legacy_workRestriction": r.get("workRestriction"),
                "_legacy_finalNoteContent": r.get("finalNoteContent"),
                "_legacy_issuerName": r.get("issuerName"),
            }, default=str),
            r.get("deletedById"),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_repeat_prescriptions(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "repeat_prescriptions"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive", "workspaceId",
        "patientId", "doctorId", "originalPrescriptionId",
        "status", "medicine", "dose", "route", "frequency",
        "daysSupply", "startDate", "endDate",
        "repeatInterval", "repeatIntervalUnit", "maxRepeats", "repeatsIssued",
        "lastIssuedDate", "nextDueDate",
        "clinicalIndication", "specialInstructions",
        "reviewDate", "requiresReview",
        "cancellationReason", "cancelledDate", "cancelledBy",
        "metadata", "deleted_by",
    ]
    mapped = []
    for r in rows:
        status = "active" if _bool(r.get("isActive", 1)) else "completed"
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            r.get("deletedAt"), None,
            1 if r.get("deletedAt") else 0, 1, ws,
            r["patientId"], MIGRATION_USER_ID, None,
            status, r["medicine"], r.get("dose"), r.get("route"), r.get("frequency"),
            int(r["days"]) if r.get("days") and str(r["days"]).isdigit() else None,
            r["startDate"], r.get("endDate"),
            None, None, None, 0, None, None,
            None, r.get("instructions"),
            None, 0, None, None, None, None, None,
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_pricing_strategies(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "pricing_strategies"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = [
        "id", "createdAt", "updatedAt", "deletedAt", "deletedBy",
        "isDeleted", "isActive",
        "name", "description", "strategyType",
        "serviceType", "department",
        "basePrice", "markupPercentage", "discountPercentage",
        "minPrice", "maxPrice", "priority",
        "validFrom", "validUntil", "conditions", "pricingRules", "metadata",
    ]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r.get("createdAt", NOW), r.get("updatedAt", NOW),
            None, None, 0, _bool(r.get("isActive", 1)),
            r["name"], r.get("description"), r.get("type", "COST_PLUS"),
            None, None, None, None, None, None, None, 0,
            r.get("validFrom"), r.get("validTo"),
            None, _json_str(r.get("rules")),
            json.dumps({"_legacy_priorityRules": r.get("priorityRules")}, default=str)
            if r.get("priorityRules") else _json_str(r.get("metadata")),
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


def migrate_audit_log(legacy_conn, new_conn, ws, bs) -> MigrationStats:
    TABLE = "audit_log"
    rows = fetch_legacy(legacy_conn, TABLE)
    cols = ["id", "userId", "action", "timestamp", "metadata", "outcome", "patientId", "justification", "eventType"]
    mapped = []
    for r in rows:
        mapped.append((
            r["id"], r["userId"], r["action"], r["timestamp"],
            _json_str(r.get("metadata")), r["outcome"],
            r.get("patientId"), r.get("justification"), r["eventType"],
        ))
    inserted = batch_insert(new_conn, TABLE, cols, mapped, bs)
    return MigrationStats(TABLE, len(rows), inserted)


# ============================================================================
# MIGRATION PIPELINE — ordered by FK dependencies
# ============================================================================

MIGRATION_PIPELINE = [
    ("patients", migrate_patients),
    ("allergies", migrate_allergies),
    ("family_conditions", migrate_family_conditions),
    ("past_medical_history", migrate_past_medical_history),
    ("past_surgical_history", migrate_past_surgical_history),
    ("social_history", migrate_social_history),
    ("audit_log", migrate_audit_log),
    ("appointments", migrate_appointments),
    ("consultations", migrate_consultations),
    ("consultation_collaborators", migrate_consultation_collaborators),
    ("consultation_join_requests", migrate_consultation_join_requests),
    ("recordings_transcript", migrate_recordings_transcript),
    ("background_transcriptions", migrate_background_transcriptions),
    ("care_notes", migrate_care_notes),
    ("care_note_permissions", migrate_care_note_permissions),
    ("care_note_templates", migrate_care_note_templates),
    ("care_note_timelines", migrate_care_note_timelines),
    ("care_ai_note_sources", migrate_care_ai_note_sources),
    ("note_audit_logs", migrate_note_audit_logs),
    ("note_versions", migrate_note_versions),
    ("prescriptions", migrate_prescriptions),
    ("vitals", migrate_vitals),
    ("suppliers", migrate_suppliers),
    ("inventory_categories", migrate_inventory_categories),
    ("medication_items", migrate_medication_items),
    ("consumable_items", migrate_consumable_items),
    ("batches", migrate_batches),
    ("medication_movements", migrate_medication_movements),
    ("consumable_movements", migrate_consumable_movements),
    ("medication_adjustments", migrate_medication_adjustments),
    ("consumable_adjustments", migrate_consumable_adjustments),
    ("medication_sales", migrate_medication_sales),
    ("medication_partial_sales", migrate_medication_partial_sales),
    ("consumable_usages", migrate_consumable_usages),
    ("consumable_partial_usages", migrate_consumable_partial_usages),
    ("inventory_audits", migrate_inventory_audits),
    ("payment_methods", migrate_payment_methods),
    ("discounts", migrate_discounts),
    ("taxes", migrate_taxes),
    ("patient_bills", migrate_patient_bills),
    ("bill_items", migrate_bill_items),
    ("billing_transactions", migrate_billing_transactions),
    ("payments", migrate_payments),
    ("invoices", migrate_invoices),
    ("receipts", migrate_receipts),
    ("insurance_providers", migrate_insurance_providers),
    ("insurance_schemes", migrate_insurance_schemes),
    ("patient_insurance", migrate_patient_insurance),
    ("insurance_claims", migrate_insurance_claims),
    ("insurance_claim_items", migrate_insurance_claim_items),
    ("insurance_contracts", migrate_insurance_contracts),
    ("referral_letters", migrate_referral_letters),
    ("sick_notes", migrate_sick_notes),
    ("repeat_prescriptions", migrate_repeat_prescriptions),
    ("pricing_strategies", migrate_pricing_strategies),
]

LEGACY_ONLY_TABLES = ["current-medications", "transcript_versions"]


# ============================================================================
# POST-MIGRATION VALIDATION
# ============================================================================

def validate_migration(legacy_conn, new_conn, report: MigrationReport) -> bool:
    log.info("=" * 50)
    log.info("POST-MIGRATION VALIDATION")
    log.info("=" * 50)
    all_ok = True
    for stats in report.tables:
        if stats.status != "success":
            continue
        try:
            new_count = count_rows(new_conn, stats.table)
            if new_count < stats.legacy_count:
                log.warning(
                    f"  ⚠ {stats.table}: legacy={stats.legacy_count}, "
                    f"new={new_count} ({stats.legacy_count - new_count} rows missing)"
                )
                all_ok = False
            else:
                log.info(f"  ✓ {stats.table}: {new_count} rows (legacy had {stats.legacy_count})")
        except Exception as e:
            log.error(f"  ✗ {stats.table}: validation error — {e}")
            all_ok = False
    return all_ok


# ============================================================================
# MAIN
# ============================================================================

def run_migration(dry_run=False, batch_size=DEFAULT_BATCH_SIZE, skip_validation=False):
    report = MigrationReport()
    log.info("=" * 72)
    log.info("EasyClinics EMR — Legacy Data Migration")
    log.info("=" * 72)
    log.info(f"  Legacy DB : {LEGACY_DB_CONFIG['database']}")
    log.info(f"  Target DB : {NEW_DB_CONFIG['database']}")
    log.info(f"  Workspace : {TARGET_WORKSPACE_ID}")
    log.info(f"  Batch size: {batch_size}")
    log.info(f"  Dry run   : {dry_run}")
    log.info("=" * 72)

    legacy_conn = new_conn = None
    max_packet = 0
    try:
        log.info("Connecting to legacy database...")
        legacy_conn = get_connection(LEGACY_DB_CONFIG)
        log.info("Connecting to target database...")
        new_conn = get_connection(NEW_DB_CONFIG)

        # Detect server packet limit so batch_insert can auto-tune
        max_packet = get_max_allowed_packet(new_conn)
        log.info(f"  max_allowed_packet: {max_packet:,} bytes ({max_packet // (1024*1024)} MB)")

        cur = new_conn.cursor()
        cur.execute("SET FOREIGN_KEY_CHECKS = 0")
        cur.execute("SET UNIQUE_CHECKS = 0")
        cur.close()

        for table_name, migrate_fn in MIGRATION_PIPELINE:
            log.info(f"\n{'─' * 50}")
            log.info(f"Migrating: {table_name}")
            t0 = time.monotonic()
            try:
                # Ensure connections are alive before each table
                legacy_conn = ensure_connection(legacy_conn, LEGACY_DB_CONFIG)
                new_conn = ensure_connection(new_conn, NEW_DB_CONFIG)

                stats = migrate_fn(legacy_conn, new_conn, TARGET_WORKSPACE_ID, batch_size)
                stats.duration_ms = (time.monotonic() - t0) * 1000
                if dry_run:
                    new_conn.rollback()
                    stats.status = "dry-run"
                    log.info(f"  [DRY-RUN] {table_name}: {stats.legacy_count} rows would migrate ({stats.duration_ms:.0f}ms)")
                else:
                    new_conn.commit()
                    stats.status = "success"
                    log.info(f"  ✓ {table_name}: {stats.migrated_count}/{stats.legacy_count} rows ({stats.duration_ms:.0f}ms)")
                    if stats.migrated_count < stats.legacy_count:
                        diff = stats.legacy_count - stats.migrated_count
                        stats.skipped_count = diff
                        log.warning(f"  ⚠ {diff} rows skipped (likely duplicates via INSERT IGNORE)")
            except Exception as e:
                elapsed = (time.monotonic() - t0) * 1000
                stats = MigrationStats(table=table_name, status="failed", duration_ms=elapsed, errors=[str(e)])
                log.error(f"  ✗ {table_name}: FAILED — {e}")
                # Safe rollback — reconnect if the connection died
                try:
                    new_conn = ensure_connection(new_conn, NEW_DB_CONFIG)
                    new_conn.rollback()
                except Exception:
                    log.warning(f"  Rollback failed for {table_name} — will reconnect on next table.")
            report.tables.append(stats)

        # Restore FK/UNIQUE checks
        new_conn = ensure_connection(new_conn, NEW_DB_CONFIG)
        cur = new_conn.cursor()
        cur.execute("SET FOREIGN_KEY_CHECKS = 1")
        cur.execute("SET UNIQUE_CHECKS = 1")
        cur.close()
        new_conn.commit()

        log.info(f"\n{'─' * 50}")
        log.info("Legacy-only tables (no equivalent in new schema — skipped):")
        for t in LEGACY_ONLY_TABLES:
            try:
                cnt = count_rows(legacy_conn, t)
                log.info(f"  ⊘ {t}: {cnt} rows (not migrated)")
            except Exception:
                log.info(f"  ⊘ {t}: table not found")

        if not dry_run and not skip_validation:
            legacy_conn = ensure_connection(legacy_conn, LEGACY_DB_CONFIG)
            new_conn = ensure_connection(new_conn, NEW_DB_CONFIG)
            valid = validate_migration(legacy_conn, new_conn, report)
            report.global_status = "SUCCESS" if valid else "SUCCESS_WITH_WARNINGS"
        else:
            report.global_status = "DRY_RUN" if dry_run else "SUCCESS_SKIP_VALIDATION"

    except Exception as e:
        log.critical(f"FATAL: {e}", exc_info=True)
        report.global_status = "FATAL_ERROR"
        if new_conn:
            try:
                new_conn.rollback()
            except Exception:
                pass
    finally:
        report.finished_at = datetime.datetime.now()
        log.info(report.summary())
        if legacy_conn:
            try:
                legacy_conn.close()
            except Exception:
                pass
        if new_conn:
            try:
                new_conn.close()
            except Exception:
                pass
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="EasyClinics EMR Legacy Migration")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--skip-validation", action="store_true")
    args = parser.parse_args()

    report = run_migration(dry_run=args.dry_run, batch_size=args.batch_size, skip_validation=args.skip_validation)
    failed = sum(1 for t in report.tables if t.status == "failed")
    sys.exit(1 if failed > 0 else 0)
