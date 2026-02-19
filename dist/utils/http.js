export function sendError(reply, code, error, message, details) {
    return reply.code(code).send({ error, message, ...(details ? { details } : {}) });
}
