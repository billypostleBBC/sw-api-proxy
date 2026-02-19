import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

export class EmailService {
  private readonly client: SESClient;

  constructor(region: string, private readonly fromEmail: string) {
    this.client = new SESClient({ region });
  }

  async sendMagicLink(email: string, link: string, scope: "admin" | "user"): Promise<void> {
    const subject = scope === "admin" ? "Admin login link" : "Your login link";
    const html = `<p>Use this secure login link:</p><p><a href="${link}">${link}</a></p><p>This link expires shortly and can only be used once.</p>`;

    await this.client.send(
      new SendEmailCommand({
        Source: this.fromEmail,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: subject },
          Body: {
            Html: { Data: html },
            Text: { Data: `Use this secure login link: ${link}` }
          }
        }
      })
    );
  }
}
