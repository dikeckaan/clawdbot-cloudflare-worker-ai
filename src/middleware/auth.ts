import type { Context, Next } from 'hono'
import type { HonoEnv } from '../types'
import { openAIError } from '../utils/errors'

/**
 * Bearer token / query param authentication middleware.
 * Only applies to /v1/* and /api/* routes.
 * If API_TOKEN is not set in the environment, auth is skipped.
 */
export async function authMiddleware(
  c: Context<HonoEnv>,
  next: Next
): Promise<Response | void> {
  const path = c.req.path

  if (!path.startsWith('/v1') && !path.startsWith('/api')) {
    return next()
  }

  const expectedToken = c.env.API_TOKEN
  if (!expectedToken) {
    return next()
  }

  const authHeader = c.req.header('Authorization')
  const queryToken = c.req.query('token') || c.req.query('key')

  let receivedToken = ''
  if (authHeader?.startsWith('Bearer ')) {
    receivedToken = authHeader.slice(7)
  } else if (queryToken) {
    receivedToken = queryToken
  }

  if (receivedToken !== expectedToken) {
    return c.json(
      openAIError('Invalid API Key', 'invalid_request_error', 'invalid_api_key'),
      401
    )
  }

  return next()
}
