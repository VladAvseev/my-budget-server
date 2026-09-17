import { pool } from '@/db/pool.js';
import { GATING_DOCUMENT_TYPE } from '@/modules/_consent/types.js';
import { KNOWN_DOCUMENT_TYPES } from '@/modules/_legal/types.js';
import { sha256Hex } from '@/shared/hash.js';
import { withTransaction } from '@/shared/transaction.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const out = (line: string): void => void process.stdout.write(`${line}\n`);
const err = (line: string): void => void process.stderr.write(`${line}\n`);

function describeError(error: unknown): string {
  const aggregate = (error as Partial<AggregateError>)?.errors;
  const base = (error as Error)?.message || String(error);
  const details = Array.isArray(aggregate)
    ? aggregate.map((inner) => (inner as Error)?.message || String(inner)).join('; ')
    : '';
  const code = (error as { code?: string })?.code;
  return [base, details, code].filter(Boolean).join(' — ');
}

const DEFAULT_DOCS_DIR = process.env.LEGAL_DOCS_DIR ?? 'docs/legal';

const MAX_DOCUMENT_BYTES = 256 * 1024;

interface Args {
  documentType?: string;
  file?: string;
  docsDir: string;
  cosmetic: boolean;
  verify: boolean;
  all: boolean;
  dryRun: boolean;
  strict: boolean;
  allowUnknown: boolean;
}

const USAGE = `Использование:
  legal:publish -- --type <document_type> [--file <путь|->] [--cosmetic] [--dry-run] [--strict]
  legal:publish -- --all [--docs-dir <путь>] [--dry-run] [--strict]
  legal:publish -- --verify [--type <document_type>] [--all]

  --type        документ (известные: ${KNOWN_DOCUMENT_TYPES.join(', ')}); новый тип — с --allow-unknown
  --file        markdown-исходник; по умолчанию <docs-dir>/<type>.md ('-' = stdin)
  --docs-dir    каталог исходников по умолчанию (сейчас: ${DEFAULT_DOCS_DIR}; env LEGAL_DOCS_DIR)
  --all         все известные типы, у которых есть файл (публикация) / проверка типов из реестра (--verify)
  --dry-run     префлайт и сравнение с текущей версией без записи в БД
  --strict      предупреждения префлайта считаются ошибками
  --cosmetic    правка текущей версии без смены version (согласия не инвалидируются)
  --verify      сверка content_hash со фактическим sha256 (без --type — всё, что есть в БД)
  --allow-unknown разрешить тип вне KNOWN_DOCUMENT_TYPES (только вместе с правкой реестра клиента)`;

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> & { documentType?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--type':
        args.documentType = argv[++i];
        break;
      case '--file':
        args.file = argv[++i];
        break;
      case '--docs-dir':
        args.docsDir = argv[++i];
        break;
      case '--cosmetic':
        args.cosmetic = true;
        break;
      case '--verify':
        args.verify = true;
        break;
      case '--all':
        args.all = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--strict':
        args.strict = true;
        break;
      case '--allow-unknown':
        args.allowUnknown = true;
        break;
      case '--help':
      case '-h':
        out(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`Неизвестный аргумент: ${token}`);
    }
  }
  return validate({
    ...args,
    docsDir: args.docsDir ?? DEFAULT_DOCS_DIR,
    cosmetic: args.cosmetic ?? false,
    verify: args.verify ?? false,
    all: args.all ?? false,
    dryRun: args.dryRun ?? false,
    strict: args.strict ?? false,
    allowUnknown: args.allowUnknown ?? false,
  });
}

function validate(args: Args): Args {
  if (args.documentType && !/^[a-z0-9_-]{1,50}$/.test(args.documentType)) {
    throw new Error(
      `Некорректный --type «${args.documentType}»: ` +
        `строчные латиница/цифры/-_ до 50 символов (например privacy_policy)`,
    );
  }
  if (args.documentType && !args.allowUnknown && !isKnownType(args.documentType)) {
    throw new Error(
      `Неизвестный тип «${args.documentType}» (известные: ${KNOWN_DOCUMENT_TYPES.join(', ')}). ` +
        `Клиент отобразит только их: новый тип публикуется вместе с реестром ` +
        `client/src/shared/legal/documents.ts, для служебных — --allow-unknown`,
    );
  }
  if (args.verify) {
    if (args.file) throw new Error('--verify не принимает --file');
    if (args.cosmetic) throw new Error('--verify не сочетается с --cosmetic');
    if (args.dryRun) throw new Error('--verify и так ничего не пишет, --dry-run не нужен');
    return args;
  }
  if (!args.documentType && !args.all) {
    throw new Error(`Нужен --type <document_type> или --all (справка: --help)`);
  }
  if (args.all && args.documentType) {
    throw new Error('--all и --type не сочетаются: выбери одно');
  }
  if (args.all && args.file) {
    throw new Error('--all использует файлы <docs-dir>/<type>.md, --file не нужен');
  }
  if (args.cosmetic && args.all) {
    throw new Error('--cosmetic требует явного --type: косметическая правка — по одному документу');
  }
  return args;
}

const isKnownType = (documentType: string): boolean =>
  (KNOWN_DOCUMENT_TYPES as readonly string[]).includes(documentType);

const isGatingType = (documentType: string): boolean => documentType === GATING_DOCUMENT_TYPE;

function defaultFile(documentType: string, docsDir: string): string {
  return join(docsDir, `${documentType}.md`);
}

function readContent(file: string): string {
  const raw = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  const content = raw.replace(/\r\n/g, '\n');
  if (content.trim() === '') {
    throw new Error(`Файл документа пуст: ${file}`);
  }
  return content;
}

interface Preflight {
  errors: string[];
  warnings: string[];
}

function preflight(documentType: string, content: string): Preflight {
  const errors: string[] = [];
  const warnings: string[] = [];

  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_DOCUMENT_BYTES) {
    errors.push(`размер ${bytes} байт превышает лимит ${MAX_DOCUMENT_BYTES}`);
  }
  if (/<\s*(script|style|iframe|object|embed|form|input|link|meta|base)\b/i.test(content)) {
    errors.push(
      'в тексте есть опасный raw-HTML (script/iframe/form/…) — клиент рендерит ' +
        'react-markdown без rehype-raw, такие конструкции недопустимы',
    );
  }
  const harmlessTags = content.match(
    /<\/?(?:div|span|br|p|a|img|table|tr|td|th|ul|li|h[1-6])\b[^>]*>/gi,
  );
  if (harmlessTags) {
    warnings.push(
      `встречаются HTML-теги (${[...new Set(harmlessTags.map((t) => t.toLowerCase()))].slice(0, 5).join(' ')}) — ` +
        'react-markdown покажет их текстом, оформляйте Markdown’ом (GFM)',
    );
  }
  if (!/^# /m.test(content)) {
    warnings.push('нет заголовка H1 («# Название») — обычно документ начинается с него');
  }
  const placeholders = [...content.matchAll(/\[([^\]\n]{1,80})\](?!\()/g)];
  if (placeholders.length > 0) {
    warnings.push(
      `похожие на незаполненные плейсхолдеры квадратные скобки: ` +
        placeholders
          .slice(0, 5)
          .map((match) => `[${match[1]}]`)
          .join(', '),
    );
  }
  if (!/оператор/i.test(content)) {
    warnings.push('нет упоминания «Оператор» — субъекту ПДн важно, кто организует обработку');
  }
  if (!/@/.test(content)) {
    warnings.push(
      'в тексте нет email для обращений субъекта (требование п.1 ч.7 ст.18 152-ФЗ / ст.14 99-З)',
    );
  }
  if (isGatingType(documentType) && !/(согласие|соглаша)/i.test(content)) {
    warnings.push('гейтящий документ: в тексте ожидаются слова «согласие/соглашаюсь»');
  }
  return { errors, warnings };
}

function reportPreflight(documentType: string, report: Preflight, strict: boolean): void {
  for (const warning of report.warnings) {
    out(`  предупреждение [${documentType}]: ${warning}`);
  }
  const blocking = strict ? [...report.errors, ...report.warnings] : report.errors;
  if (blocking.length > 0) {
    throw new Error(
      `префлайт не пройден (${blocking.length}):\n  ${blocking.join('\n  ')}` +
        (report.warnings.length > 0 && !strict
          ? '\n  (с --strict предупреждения тоже блокируют публикацию)'
          : ''),
    );
  }
}

function todayVersion(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' })
    .format(new Date())
    .slice(0, 10);
}

interface CurrentRow {
  version: string;
  content_hash: string;
}

async function findCurrent(documentType: string): Promise<CurrentRow | undefined> {
  const { rows } = await pool.query<CurrentRow>(
    `SELECT version, content_hash FROM public.legal_documents
      WHERE document_type = $1 AND is_current
      LIMIT 1`,
    [documentType],
  );
  return rows[0];
}

async function nextVersion(
  query: (sql: string, params: unknown[]) => Promise<{ rows: { taken: boolean }[] }>,
  documentType: string,
): Promise<string> {
  let version = todayVersion();
  for (let n = 2; n < 100; n += 1) {
    const { rows } = await query(
      `SELECT EXISTS (
         SELECT 1 FROM public.legal_documents
          WHERE document_type = $1 AND version = $2
       ) AS taken`,
      [documentType, version],
    );
    if (!rows[0].taken) {
      return version;
    }
    version = `${todayVersion()}-${n}`;
  }
  throw new Error(`Не удалось подобрать свободную версию для ${documentType} за 99 попыток`);
}

type PublishKind = 'unchanged' | 'cosmetic' | 'published';

async function publish(
  documentType: string,
  content: string,
  cosmetic: boolean,
): Promise<PublishKind> {
  const hash = sha256Hex(content);

  const result = await withTransaction<{ kind: PublishKind; version: string }>(async (client) => {
    const current = await client.query<CurrentRow>(
      `SELECT version, content_hash FROM public.legal_documents
        WHERE document_type = $1 AND is_current
        LIMIT 1`,
      [documentType],
    );
    const currentRow = current.rows[0];

    if (cosmetic) {

      if (!currentRow) {
        throw new Error(
          `Текущая версия ${documentType} не найдена — косметическая правка невозможна`,
        );
      }
      if (currentRow.content_hash === hash) {
        return { kind: 'unchanged', version: currentRow.version };
      }
      await client.query(
        `UPDATE public.legal_documents
            SET content = $2, content_hash = $3
          WHERE document_type = $1 AND is_current`,
        [documentType, content, hash],
      );
      return { kind: 'cosmetic', version: currentRow.version };
    }

    if (currentRow && currentRow.content_hash === hash) {
      return { kind: 'unchanged', version: currentRow.version };
    }

    const version = await nextVersion(
      (sql, params) => client.query<{ taken: boolean }>(sql, params as never[]),
      documentType,
    );

    await client.query(
      `UPDATE public.legal_documents
          SET is_current = false
        WHERE document_type = $1 AND is_current`,
      [documentType],
    );
    await client.query(
      `INSERT INTO public.legal_documents
         (document_type, version, published_at, is_current, content, content_hash)
       VALUES ($1, $2, now(), true, $3, $4)`,
      [documentType, version, content, hash],
    );
    return { kind: 'published', version };
  });

  switch (result.kind) {
    case 'unchanged':
      out(
        `${documentType}: текст идентичен текущей версии ${result.version} — ` +
          `публикация не требуется (версии и согласия пользователей не меняются).`,
      );
      return result.kind;
    case 'cosmetic':
      out(
        `${documentType}: КОСМЕТИЧЕСКАЯ ПРАВКА версии ${result.version} (согласия не инвалидируются):\n` +
          `  content_hash = ${hash}\n` +
          `  Факт правки обязан быть зафиксирован в коммит-сообщении/журнале публикации.`,
      );
      return result.kind;
    case 'published':
      out(
        `${documentType}: опубликована версия ${result.version}\n` +
          `  content_hash = ${hash}\n` +
          `  size = ${Buffer.byteLength(content, 'utf8')} байт\n` +
          (isGatingType(documentType)
            ? `  ВНИМАНИЕ: ${documentType} участвует в consent-gate — все пользователи ` +
              `с прежним согласием при следующем входе получат NEEDS_CONSENT.`
            : `  Документ информационный: consent-gate на него не ссылается, ` +
              `согласия пользователей НЕ инвалидируются.`),
      );
      return result.kind;
  }
}

async function dryRun(documentType: string, content: string, cosmetic: boolean): Promise<void> {
  const hash = sha256Hex(content);
  const current = await findCurrent(documentType);

  if (!current) {
    if (cosmetic) {
      out(
        `${documentType}: --dry-run — косметическая правка невозможна: ` +
          `текущей версии нет, доступна только обычная публикация (${todayVersion()}).`,
      );
      return;
    }
    out(
      `${documentType}: --dry-run — документ ещё не публиковался, версия ${todayVersion()} будет создана.`,
    );
    return;
  }
  if (current.content_hash === hash) {
    out(
      `${documentType}: --dry-run — текст совпадает с текущей версией ${current.version}, публикации не будет.`,
    );
    return;
  }
  const version = cosmetic
    ? current.version
    : await nextVersion(
        (sql, params) => pool.query<{ taken: boolean }>(sql, params as never[]),
        documentType,
      );
  out(
    `${documentType}: --dry-run — ${cosmetic ? 'косметическая правка без смены версии' : 'была бы опубликована версия'} ` +
      `${version} (текущая ${current.version}), content_hash = ${hash}.`,
  );
}

async function publishedTypes(): Promise<string[]> {
  const { rows } = await pool.query<{ document_type: string }>(
    `SELECT DISTINCT document_type FROM public.legal_documents ORDER BY document_type`,
  );
  return rows.map((row) => row.document_type);
}

async function verifyOne(documentType: string): Promise<number> {
  const { rows } = await pool.query<{
    version: string;
    is_current: boolean;
    content: string;
    content_hash: string;
  }>(
    `SELECT version, is_current, content, content_hash
       FROM public.legal_documents
      WHERE document_type = $1
      ORDER BY published_at`,
    [documentType],
  );

  if (rows.length === 0) {
    err(`${documentType}: документ не опубликован`);
    return 1;
  }

  let bad = 0;
  let currentCount = 0;
  for (const row of rows) {
    if (row.is_current) currentCount += 1;
    const actual = sha256Hex(row.content);
    const ok = actual === row.content_hash;
    if (!ok) bad += 1;
    out(
      `${ok ? 'OK  ' : 'FAIL'} ${documentType} ${row.version}` +
        `${row.is_current ? ' (current)' : ''}` +
        (ok ? '' : `\n     ожидался ${row.content_hash}, фактический ${actual}`),
    );
  }

  if (currentCount !== 1) {
    err(`${documentType}: строк с is_current = ${currentCount} (должна быть ровно одна)`);
    bad += 1;
  }
  if (!isKnownType(documentType)) {
    out(`  предупреждение: тип ${documentType} отсутствует в реестре клиента — UI его не покажет`);
  }
  if (bad > 0) {
    err(`${documentType}: ${bad} проблемных проверок (детали выше)`);
  }
  return bad;
}

async function verify(types: string[]): Promise<void> {
  if (types.length === 0) {
    err(
      'Ни одного юридического документа не опубликовано — consent-gate и регистрация ' +
        'не работают, выполните публикацию (см. docs/legal/README.md)',
    );
    process.exitCode = 1;
    return;
  }
  let bad = 0;
  for (const type of types) {
    bad += await verifyOne(type);
  }
  if (bad > 0) {
    err(
      `legal:verify — проблемных строк: ${bad} (несовпадение content_hash с sha256 ` +
        `или не одна is_current = правка в обход процесса публикации)`,
    );
    process.exitCode = 1;
  } else {
    out(`legal:verify — OK: проверено типов: ${types.length}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.verify) {
    const types = args.documentType
      ? [args.documentType]
      : args.all
        ? [...KNOWN_DOCUMENT_TYPES]
        : await publishedTypes();
    await verify(types);
    return;
  }

  const types = args.all ? [...KNOWN_DOCUMENT_TYPES] : [args.documentType!];
  let published = 0;
  for (const documentType of types) {
    const file = args.file ?? defaultFile(documentType, args.docsDir);
    if (file !== '-' && !existsSync(file)) {
      if (!args.all) {
        throw new Error(`Файл ${file} не найден (нужен --file <путь> или --docs-dir)`);
      }
      out(`${documentType}: файл ${file} не найден — пропускаю (--all публикует только имеющиеся)`);
      continue;
    }
    const content = readContent(file);
    reportPreflight(documentType, preflight(documentType, content), args.strict);
    if (args.dryRun) {
      await dryRun(documentType, content, args.cosmetic);
      continue;
    }
    const kind = await publish(documentType, content, args.cosmetic);
    if (kind === 'published' || kind === 'cosmetic') published += 1;
  }

  if (args.all && !args.dryRun && published === 0) {
    out('Ни один документ не изменился — записей в legal_documents нет.');
  }
}

main()
  .catch((error: unknown) => {
    err(`legal:publish — ошибка: ${describeError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
