import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type WtppPiiField = 'taxId' | 'nationalIdOrPassport';

const ENVELOPE_PREFIX = 'wtpp:v1:';
const ASSOCIATED_DATA_PREFIX = 'watchtube:wtpp:v1:';

export class WtppPiiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WtppPiiConfigurationError';
  }
}

export class WtppPiiCiphertextError extends Error {
  constructor() {
    super('WTPP identity ciphertext is invalid or cannot be authenticated.');
    this.name = 'WtppPiiCiphertextError';
  }
}

function getEncryptionKey(): Buffer {
  const configured = process.env.WTPP_PII_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new WtppPiiConfigurationError(
      'WTPP_PII_ENCRYPTION_KEY is required to store tax and identity data.',
    );
  }

  const key = Buffer.from(configured, 'base64');
  if (key.length !== 32 || key.toString('base64') !== configured) {
    throw new WtppPiiConfigurationError(
      'WTPP_PII_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.',
    );
  }
  return key;
}

function getAssociatedData(field: WtppPiiField): Buffer {
  return Buffer.from(`${ASSOCIATED_DATA_PREFIX}${field}`);
}

export function isEncryptedWtppPii(value: string | null): boolean {
  return value?.startsWith(ENVELOPE_PREFIX) ?? false;
}

export function encryptWtppPii(value: string, field: WtppPiiField): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(getAssociatedData(field));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  return [
    'wtpp',
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptWtppPii(value: string, field: WtppPiiField): string {
  if (!isEncryptedWtppPii(value)) throw new WtppPiiCiphertextError();
  const parts = value.split(':');
  if (parts.length !== 5 || parts[0] !== 'wtpp' || parts[1] !== 'v1') {
    throw new WtppPiiCiphertextError();
  }

  try {
    const [ivText, tagText, encryptedText] = parts.slice(2);
    const iv = Buffer.from(ivText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    const encrypted = Buffer.from(encryptedText, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new WtppPiiCiphertextError();

    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAAD(getAssociatedData(field));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof WtppPiiConfigurationError) throw error;
    throw new WtppPiiCiphertextError();
  }
}

function protectExistingValue(value: string | null, field: WtppPiiField): string | null {
  if (value === null) return null;
  if (isEncryptedWtppPii(value)) {
    decryptWtppPii(value, field);
    return value;
  }
  return encryptWtppPii(value, field);
}

export interface WtppPiiRecord {
  id: string;
  taxId: string | null;
  nationalIdOrPassport: string | null;
}

export type WtppPiiUpdate = WtppPiiRecord;

export interface WtppPiiMigrationRepository {
  listSensitiveFields(): Promise<WtppPiiRecord[]>;
  updateSensitiveFields(updates: WtppPiiUpdate[]): Promise<void>;
}

export async function migrateWtppPiiRecords(
  repository: WtppPiiMigrationRepository,
  apply: boolean,
): Promise<{ scanned: number; encrypted: number }> {
  const records = await repository.listSensitiveFields();
  const updates: WtppPiiUpdate[] = [];

  for (const record of records) {
    const taxId = protectExistingValue(record.taxId, 'taxId');
    const nationalIdOrPassport = protectExistingValue(
      record.nationalIdOrPassport,
      'nationalIdOrPassport',
    );

    if (
      taxId !== record.taxId
      || nationalIdOrPassport !== record.nationalIdOrPassport
    ) {
      updates.push({ id: record.id, taxId, nationalIdOrPassport });
    }
  }

  if (apply && updates.length > 0) {
    await repository.updateSensitiveFields(updates);
  }

  return { scanned: records.length, encrypted: updates.length };
}
