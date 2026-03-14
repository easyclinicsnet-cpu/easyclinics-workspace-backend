import { Injectable, Inject } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

@Injectable()
export class Aes256Service {
  private readonly algorithm = 'aes-256-cbc';
  private readonly key: Promise<Buffer>;

  constructor(@Inject('AES256_CONFIG') private readonly config: { key: string; salt: string }) {
    if (!config.key || config.key.length < 32) {
      throw new Error('Encryption key must be at least 32 characters');
    }
    if (!config.salt) {
      throw new Error('ENCRYPTION_SALT is required');
    }
    this.key = this.deriveKey(config.key, config.salt);
  }

  private async deriveKey(secret: string, salt: string): Promise<Buffer> {
    return (await promisify(scrypt)(secret, salt, 32)) as Buffer;
  }

  async encrypt(text: string): Promise<string> {
    if (!text) return text;

    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, await this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final()
    ]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  async decrypt(encryptedText: string): Promise<string> {
    if (!encryptedText) return encryptedText;

    const [ivHex, contentHex] = encryptedText.split(':');
    if (!ivHex || !contentHex) {
      throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv(this.algorithm, await this.key, iv);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(contentHex, 'hex')),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  }
}
