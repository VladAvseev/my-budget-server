import { createHash } from 'node:crypto';

/**
 * hex sha256 от текста в нормализованных переводах строк.
 *
 * Нормализация CRLF → LF обязательна: файл Markdown, сохранённый Windows-
 * редактором и скачанный с Linux, дал бы разные хэши «одного и того же»
 * текста, и контроль целостности легальных документов начал бы сыпать
 * ложными инцидентами.
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}
