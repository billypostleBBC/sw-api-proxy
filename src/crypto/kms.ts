import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";

export class KmsService {
  private readonly client: KMSClient;

  constructor(region: string, private readonly keyId: string) {
    this.client = new KMSClient({ region });
  }

  async encrypt(plaintext: string): Promise<string> {
    const response = await this.client.send(
      new EncryptCommand({
        KeyId: this.keyId,
        Plaintext: Buffer.from(plaintext, "utf8")
      })
    );
    if (!response.CiphertextBlob) {
      throw new Error("KMS encrypt failed");
    }
    return Buffer.from(response.CiphertextBlob).toString("base64");
  }

  async decrypt(ciphertextB64: string): Promise<string> {
    const response = await this.client.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(ciphertextB64, "base64")
      })
    );
    if (!response.Plaintext) {
      throw new Error("KMS decrypt failed");
    }
    return Buffer.from(response.Plaintext).toString("utf8");
  }
}
