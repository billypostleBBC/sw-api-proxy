export async function resolveProxyAuth(request, repo) {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
        return null;
    }
    const token = auth.slice("Bearer ".length).trim();
    return repo.findAuthByToolToken(token);
}
