/**
 * @deprecated Database is now on Cloud SQL PostgreSQL.
 * No manual backup needed — Cloud SQL handles automated backups.
 */
export async function backupDb(): Promise<boolean> {
  // No-op: Cloud SQL handles backups automatically
  return true
}
