export class OpenAIClient {
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    async request(path, apiKey, body) {
        return fetch(`${this.baseUrl}${path}`, {
            method: body ? "POST" : "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: body ? JSON.stringify(body) : undefined
        });
    }
}
