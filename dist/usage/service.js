export class UsageService {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    async log(input) {
        await this.repo.logUsage(input);
    }
    async audit(input) {
        await this.repo.logAudit(input);
    }
}
