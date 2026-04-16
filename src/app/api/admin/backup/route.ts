import { NextResponse } from 'next/server'

// POST: No-op — Cloud SQL handles backups automatically
export async function POST() {
  return NextResponse.json({
    success: true,
    message: 'Database is on Cloud SQL PostgreSQL — backups are automatic.',
  })
}

// GET: Check backup status
export async function GET() {
  return NextResponse.json({
    hasBackup: true,
    details: 'Using Cloud SQL PostgreSQL with automated backups.',
  })
}
