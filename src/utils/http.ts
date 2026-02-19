import { FastifyReply } from "fastify";

export function sendError(
  reply: FastifyReply,
  code: number,
  error: string,
  message: string,
  details?: Record<string, unknown>
): FastifyReply {
  return reply.code(code).send({ error, message, ...(details ? { details } : {}) });
}
