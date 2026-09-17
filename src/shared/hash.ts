import { createHash } from 'node:crypto';

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}
