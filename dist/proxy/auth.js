export async function resolveProxyAuth(request, repo, ticketService) {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
        return null;
    }
    const token = auth.slice("Bearer ".length).trim();
    const toolAuth = await repo.findAuthByToolToken(token);
    if (toolAuth) {
        return toolAuth;
    }
    try {
        const claims = await ticketService.verifyTicket(token);
        return {
            mode: "ticket",
            toolId: claims.toolId,
            toolSlug: claims.toolSlug,
            projectId: claims.projectId,
            projectSlug: claims.projectSlug,
            projectStatus: "active",
            rpmCap: claims.rpmCap,
            dailyTokenCap: claims.dailyTokenCap
        };
    }
    catch {
        return null;
    }
}
