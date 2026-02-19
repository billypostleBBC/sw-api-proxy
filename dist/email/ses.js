import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
export class EmailService {
    fromEmail;
    client;
    constructor(region, fromEmail) {
        this.fromEmail = fromEmail;
        this.client = new SESClient({ region });
    }
    async sendMagicLink(email, link, scope) {
        const subject = scope === "admin" ? "Admin login link" : "Your login link";
        const html = `<p>Use this secure login link:</p><p><a href="${link}">${link}</a></p><p>This link expires shortly and can only be used once.</p>`;
        await this.client.send(new SendEmailCommand({
            Source: this.fromEmail,
            Destination: { ToAddresses: [email] },
            Message: {
                Subject: { Data: subject },
                Body: {
                    Html: { Data: html },
                    Text: { Data: `Use this secure login link: ${link}` }
                }
            }
        }));
    }
}
