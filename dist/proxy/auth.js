import { AuthService } from "../auth/service.js";
export async function resolveProxyAuth(request, repo) {
    const token = AuthService.getBearerToken(request);
    if (!token) {
        return null;
    }
    return repo.findAuthByToolToken(token);
}
