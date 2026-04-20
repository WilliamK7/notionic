import { NextResponse } from 'next/server'
import { NextComment } from '@fuma-comment/server/next'
import { auth, storage } from '@/lib/comment-config'
import { ensureDbTables } from '@/lib/db'

const { GET: _GET, POST: _POST, PATCH: _PATCH, DELETE: _DELETE } = NextComment({ auth, storage })

async function withParams(handler, req, ctx) {
  try {
    await ensureDbTables()
  } catch (e) {
    console.error('[comments] DB init failed:', e.message)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  }
  const params = await ctx.params
  const normalized = { comment: params?.comment ?? [] }
  return handler(req, { ...ctx, params: Promise.resolve(normalized) })
}

export const GET = (req, ctx) => withParams(_GET, req, ctx)
export const POST = (req, ctx) => withParams(_POST, req, ctx)
export const PATCH = (req, ctx) => withParams(_PATCH, req, ctx)
export const DELETE = (req, ctx) => withParams(_DELETE, req, ctx)
