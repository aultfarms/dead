import type { TrelloCard } from '@aultfarms/trello';
import type { client } from '@aultfarms/trello';
import { buildLivestockIndexes, tagObjToStr, tagStrToObj } from './util.js';
import type {
  DeadRecord,
  ErrorRecord,
  IncomingRecord,
  LivestockCardMetadata,
  LivestockConfig,
  LivestockListName,
  LivestockRecords,
  ParseFailure,
  ParseIssue,
  ParseResult,
  ParseSuccess,
  Tag,
  TagColors,
  TagRange,
  TreatmentProtocolTokenization,
  TreatmentRecord,
  TreatmentType,
} from './types.js';


export type LivestockCardSource = Pick<
  TrelloCard,
  'id' | 'idList' | 'name' | 'dateLastActivity'
> & Partial<Pick<TrelloCard, 'desc'>> & {
  shortUrl?: string;
  url?: string;
};

export type RecordParseOptions = {
  tagColors?: TagColors;
  treatmentTypes?: TreatmentType[];
};

function metadataFor(card: LivestockCardSource): LivestockCardMetadata {
  return {
    id: card.id,
    idList: card.idList,
    cardName: card.name,
    dateLastActivity: card.dateLastActivity,
    trelloUrl: card.shortUrl || card.url,
    raw: { name: card.name, description: card.desc },
  };
}

function issue(
  code: ParseIssue['code'],
  message: string,
  options: Partial<Omit<ParseIssue, 'code' | 'message' | 'severity'>> & {
    severity?: ParseIssue['severity'];
  } = {},
): ParseIssue {
  const { severity = 'error', ...rest } = options;
  return { code, message, severity, ...rest };
}

function failed<T>(issues: ParseIssue[], metadata?: LivestockCardMetadata): ParseResult<T> {
  return { ok: false, issues, metadata };
}

function succeeded<T>(
  record: T,
  issues: ParseIssue[],
  metadata: LivestockCardMetadata,
): ParseSuccess<T> {
  return { ok: true, record, issues, metadata };
}

function hasErrors(issues: ParseIssue[]): boolean {
  return issues.some(current => current.severity === 'error');
}

function contextualizeIssues(
  issues: ParseIssue[],
  listName: LivestockListName,
  metadata?: LivestockCardMetadata,
): ParseIssue[] {
  return issues.map(current => ({ ...current, listName, card: metadata }));
}

function errorRecordFor(result: ParseFailure): ErrorRecord {
  const first = result.issues.find(current => current.severity === 'error')
    || result.issues[0]
    || issue('invalid-card-format', 'Unknown card parsing error');
  return {
    cardName: result.metadata?.cardName,
    idList: result.metadata?.idList,
    id: result.metadata?.id,
    dateLastActivity: result.metadata?.dateLastActivity,
    error: first.message,
    code: first.code,
    issues: result.issues,
  };
}

function normalizeDate(
  value: string,
  options: { allowSingleDigitParts?: boolean } = {},
): { date?: string; issues: ParseIssue[] } {
  const pattern = options.allowSingleDigitParts
    ? /^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/
    : /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
  const match = value.match(pattern);
  if (!match) {
    return {
      issues: [issue('invalid-date', `Invalid calendar date "${value}"`, {
        field: 'date',
        expected: 'YYYY-MM-DD',
      })],
    };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    return {
      issues: [issue('invalid-date', `Invalid calendar date "${value}"`, {
        field: 'date',
        expected: 'A real calendar date in YYYY-MM-DD format',
      })],
    };
  }
  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const issues: ParseIssue[] = [];
  if (date !== value) {
    issues.push(issue('legacy-date-normalized', `Normalized legacy date "${value}" to "${date}"`, {
      severity: 'warning',
      field: 'date',
      suggestion: date,
    }));
  }
  return { date, issues };
}

function parseTag(raw: string): { tag?: Tag; issues: ParseIssue[] } {
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, '');
  const parsed = tagStrToObj(normalized);
  if (!parsed || !Number.isSafeInteger(parsed.number) || parsed.number < 1) {
    return {
      issues: [issue('invalid-tag', `Invalid tag "${raw}"`, {
        field: 'tag',
        expected: 'COLOR followed by a positive whole number',
      })],
    };
  }
  return {
    tag: { ...parsed, color: parsed.color.toUpperCase() },
    issues: [],
  };
}

function parseTagRange(raw: string): { ranges?: TagRange[]; issues: ParseIssue[] } {
  const parts = raw.split('-');
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
    return {
      issues: [issue('invalid-tag-range', `Invalid tag range "${raw}"`, {
        field: 'tags',
        expected: 'STARTTAG-ENDTAG',
      })],
    };
  }
  const startResult = parseTag(parts[0]);
  const endResult = parseTag(parts[1]);
  const issues = [...startResult.issues, ...endResult.issues];
  if (!startResult.tag || !endResult.tag || hasErrors(issues)) return { issues };
  const start = startResult.tag;
  const end = endResult.tag;
  if (start.groupname || end.groupname) {
    issues.push(issue('invalid-tag-range', `Group-qualified tags are not valid in range "${raw}"`, {
      field: 'tags',
      expected: 'Unqualified COLORNUMBER-COLORNUMBER tags',
    }));
    return { issues };
  }
  if (start.color === end.color && start.number > end.number) {
    issues.push(issue('invalid-tag-range', `Tag range starts after it ends in "${raw}"`, {
      field: 'tags',
      expected: 'A range whose starting number is not greater than its ending number',
    }));
    return { issues };
  }
  if (start.color !== end.color) {
    return {
      ranges: [
        { start, end: { color: start.color, number: 1000 } },
        { start: { color: end.color, number: 1 }, end },
      ],
      issues,
    };
  }
  return { ranges: [{ start, end }], issues };
}

export function serializeIncomingRecord(record: Pick<
  IncomingRecord,
  'date' | 'groupname' | 'into' | 'weight' | 'head' | 'tags'
>): string {
  const properties: string[] = [];
  if (record.into !== undefined) properties.push(`Into: ${record.into}`);
  if (record.weight !== undefined) properties.push(`Weight: ${record.weight}`);
  if (record.head !== undefined) properties.push(`Head: ${record.head}`);
  if (record.tags !== undefined) {
    properties.push(`Tags: ${record.tags.map(range => (
      `${tagObjToStr(range.start)}-${tagObjToStr(range.end)}`
    )).join(',')}`);
  }
  return `${record.date}: ${record.groupname};${properties.length ? ` ${properties.join('; ')};` : ''}`;
}

export function parseIncomingCard(
  card: LivestockCardSource | null | undefined,
  _options: RecordParseOptions = {},
): ParseResult<IncomingRecord> {
  if (!card) return failed([issue('card-missing', 'Incoming card was missing')]);
  const metadata = metadataFor(card);
  const issues: ParseIssue[] = [];
  const semicolon = card.name.indexOf(';');
  if (semicolon < 0) {
    return failed([issue('invalid-card-format', `Incoming card "${card.name}" has no property separator`, {
      expected: 'YYYY-MM-DD: GROUP; Property: value;',
      suggestion: `${card.name};`,
    })], metadata);
  }
  const header = card.name.slice(0, semicolon).trim();
  const headerMatch = header.match(/^([0-9]{4}-[0-9]{1,2}-[0-9]{1,2}):?\s*(.+)$/);
  if (!headerMatch?.[1] || !headerMatch[2]?.trim()) {
    return failed([issue('invalid-card-format', `Invalid Incoming card header "${header}"`, {
      expected: 'YYYY-MM-DD: GROUP',
    })], metadata);
  }
  const dateResult = normalizeDate(headerMatch[1]);
  issues.push(...dateResult.issues);
  const groupname = headerMatch[2].trim();
  if (!groupname) {
    issues.push(issue('missing-required-field', 'Incoming group name is required', {
      field: 'groupname',
    }));
  }
  const parsed: Pick<IncomingRecord, 'into' | 'weight' | 'head' | 'tags'> = {};
  const propertyText = card.name.slice(semicolon + 1);
  for (const rawPart of propertyText.split(';')) {
    const part = rawPart.trim();
    if (!part) continue;
    const colon = part.indexOf(':');
    if (colon < 1) {
      issues.push(issue('invalid-card-format', `Unable to parse Incoming property "${part}"`, {
        expected: 'Property: value',
      }));
      continue;
    }
    const key = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (!value) {
      issues.push(issue('missing-required-field', `Incoming property "${key}" has no value`, {
        field: key,
      }));
      continue;
    }
    if (key === 'into') {
      parsed.into = value;
    } else if (key === 'weight') {
      const weight = Number(value);
      if (!Number.isFinite(weight) || weight <= 0) {
        issues.push(issue('invalid-number', `Invalid incoming weight "${value}"`, {
          field: 'weight',
          expected: 'A number greater than zero',
        }));
      } else {
        parsed.weight = weight;
      }
    } else if (key === 'head') {
      const head = Number(value);
      if (!Number.isSafeInteger(head) || head <= 0) {
        issues.push(issue('invalid-number', `Invalid incoming head count "${value}"`, {
          field: 'head',
          expected: 'A positive whole number',
        }));
      } else {
        parsed.head = head;
      }
    } else if (key === 'tags') {
      const ranges: TagRange[] = [];
      for (const rawRange of value.split(',')) {
        const rangeResult = parseTagRange(rawRange.trim());
        issues.push(...rangeResult.issues);
        if (rangeResult.ranges) ranges.push(...rangeResult.ranges);
      }
      if (ranges.length === 0) {
        issues.push(issue('invalid-tag-range', 'Incoming Tags property contains no valid ranges', {
          field: 'tags',
        }));
      } else {
        parsed.tags = ranges;
      }
    } else {
      issues.push(issue('unknown-property', `Unknown Incoming property "${key}" was ignored`, {
        severity: 'warning',
        field: key,
      }));
    }
  }
  if (!dateResult.date || hasErrors(issues)) return failed(issues, metadata);
  const record: IncomingRecord = {
    date: dateResult.date,
    groupname,
    ...parsed,
    id: card.id,
    idList: card.idList,
    cardName: card.name,
    dateLastActivity: card.dateLastActivity,
    issues,
    metadata,
  };
  return succeeded(record, issues, metadata);
}

export function tokenizeTreatmentProtocol(
  protocol: string,
  treatmentTypes: TreatmentType[],
): TreatmentProtocolTokenization {
  const sorted = [...treatmentTypes].sort((left, right) => (
    right.code.length - left.code.length || left.code.localeCompare(right.code)
  ));
  const tokens: TreatmentProtocolTokenization['tokens'] = [];
  const unknown: TreatmentProtocolTokenization['unknown'] = [];
  let offset = 0;
  while (offset < protocol.length) {
    const delimiter = protocol[offset];
    if (delimiter && /[\s,+/]/.test(delimiter)) {
      offset += 1;
      continue;
    }
    const found = sorted.find(type => protocol.startsWith(type.code, offset));
    if (found) {
      tokens.push({
        code: found.code,
        name: found.name,
        start: offset,
        end: offset + found.code.length,
      });
      offset += found.code.length;
      continue;
    }
    const start = offset;
    offset += 1;
    while (
      offset < protocol.length
      && !sorted.some(type => protocol.startsWith(type.code, offset))
      && !/[\s,+/]/.test(protocol[offset] || '')
    ) {
      offset += 1;
    }
    unknown.push({ text: protocol.slice(start, offset), start, end: offset });
  }
  return { protocol, tokens, unknown };
}

export function serializeTreatmentRecord(record: Pick<
  TreatmentRecord,
  'date' | 'treatment' | 'tags'
>): string {
  return `${record.date}: ${record.treatment}: ${record.tags.map(tagObjToStr).join(' ')}`;
}

export function parseTreatmentCard(
  card: LivestockCardSource | null | undefined,
  _options: RecordParseOptions = {},
): ParseResult<TreatmentRecord> {
  if (!card) return failed([issue('card-missing', 'Treatment card was missing')]);
  const metadata = metadataFor(card);
  const issues: ParseIssue[] = [];
  const dateMatch = card.name.match(/^([0-9]{4}-[0-9]{1,2}-[0-9]{1,2}):\s*(.*)$/);
  if (!dateMatch?.[1]) {
    return failed([issue('invalid-card-format', `Invalid Treatment card "${card.name}"`, {
      expected: 'YYYY-MM-DD: PROTOCOL: TAG TAG',
    })], metadata);
  }
  const dateResult = normalizeDate(dateMatch[1]);
  issues.push(...dateResult.issues);
  const rest = dateMatch[2] || '';
  const treatmentSeparator = rest.indexOf(':');
  if (treatmentSeparator < 1) {
    issues.push(issue('missing-required-field', 'Treatment protocol is required', {
      field: 'treatment',
      expected: 'YYYY-MM-DD: PROTOCOL: TAG TAG',
    }));
    return failed(issues, metadata);
  }
  const treatment = rest.slice(0, treatmentSeparator).trim();
  const tagText = rest.slice(treatmentSeparator + 1).trim();
  if (!treatment) {
    issues.push(issue('missing-required-field', 'Treatment protocol is required', {
      field: 'treatment',
    }));
  }
  if (!tagText) {
    issues.push(issue('missing-required-field', 'At least one treated tag is required', {
      field: 'tags',
    }));
  }
  const tags: Tag[] = [];
  for (const rawTag of tagText.split(/\s+/).filter(Boolean)) {
    const tagResult = parseTag(rawTag);
    issues.push(...tagResult.issues);
    if (tagResult.tag && !hasErrors(tagResult.issues)) tags.push(tagResult.tag);
  }
  if (!dateResult.date || tags.length === 0 || hasErrors(issues)) return failed(issues, metadata);
  const record: TreatmentRecord = {
    date: dateResult.date,
    treatment,
    tags,
    id: card.id,
    idList: card.idList,
    cardName: card.name,
    dateLastActivity: card.dateLastActivity,
    issues,
    metadata,
  };
  return succeeded(record, issues, metadata);
}

const legacyDeadTextPattern = /\b(?:[NSB][0-9S]{1,2}|OB[SN]?[NS]?|HB|HEIFER|DRY(?:\s+(?:LOT|COW))?|DAIRY|APRIL'?S?|WOODS|BARN\s*[1-3]|DEAD|TOTAL|AND)\b/gi;
const deadTagPattern = /(?:[A-Z]+:[A-Z]{3}[0-9]{2}-[A-Z0-9]:)?[A-Za-z]+\s*[0-9]+|\bNOTAG\b|\bNT\b/gi;

export function serializeDeadRecord(record: Pick<
  DeadRecord,
  'date' | 'tags' | 'note'
>): string {
  const tags = record.tags.map(tagObjToStr).join(' ');
  const note = record.note ? ` Note: ${String(record.note).trim()}` : '';
  return `${record.date}: ${tags}${note}`;
}

export function parseDeadCard(
  card: LivestockCardSource | null | undefined,
  _options: RecordParseOptions = {},
): ParseResult<DeadRecord> {
  if (!card) return failed([issue('card-missing', 'Dead card was missing')]);
  const metadata = metadataFor(card);
  const issues: ParseIssue[] = [];
  const match = card.name.match(/^([0-9]{4}-[0-9]{1,2}-[0-9]{1,2}):?\s*(.*)$/);
  if (!match?.[1]) {
    return failed([issue('invalid-card-format', `Invalid Dead card "${card.name}"`, {
      expected: 'YYYY-MM-DD: TAG TAG Note: optional note',
    })], metadata);
  }
  const dateResult = normalizeDate(match[1], { allowSingleDigitParts: true });
  issues.push(...dateResult.issues);
  let body = match[2] || '';
  let noteValue: string | false = false;
  const noteMatch = body.match(/\bnote\s*:\s*(.*)$/i);
  if (noteMatch) {
    noteValue = noteMatch[1]?.trim() || false;
    body = body.slice(0, noteMatch.index).trim();
  }
  const parenthetical = [...body.matchAll(/\([^)]*\)/g)].map(found => found[0]);
  if (parenthetical.length > 0) {
    issues.push(issue('legacy-dead-text', `Ignored historical parenthetical text: ${parenthetical.join(', ')}`, {
      severity: 'warning',
      field: 'tags',
    }));
    body = body.replace(/\([^)]*\)/g, ' ');
  }
  const historicalLabels = body.match(legacyDeadTextPattern) || [];
  if (historicalLabels.length > 0) {
    issues.push(issue('legacy-dead-text', `Ignored historical pen/summary text: ${historicalLabels.join(', ')}`, {
      severity: 'warning',
      field: 'tags',
    }));
    body = body.replace(legacyDeadTextPattern, ' ');
  }
  const rawTags = body.match(deadTagPattern) || [];
  const leftovers = body.replace(deadTagPattern, ' ').replace(/[,;:/-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (leftovers) {
    issues.push(issue('legacy-dead-text', `Ignored unrecognized historical Dead text: "${leftovers}"`, {
      severity: 'warning',
      field: 'tags',
    }));
  }
  const tags: Tag[] = [];
  for (let rawTag of rawTags) {
    if (/^(?:NT|NOTAG)$/i.test(rawTag.trim())) {
      issues.push(issue('legacy-notag-normalized', `Normalized "${rawTag.trim()}" to "NOTAG1"`, {
        severity: 'warning',
        field: 'tags',
        suggestion: 'NOTAG1',
      }));
      rawTag = 'NOTAG1';
    }
    const tagResult = parseTag(rawTag);
    issues.push(...tagResult.issues);
    if (tagResult.tag && !hasErrors(tagResult.issues)) tags.push(tagResult.tag);
  }
  if (tags.length === 0) {
    issues.push(issue('missing-required-field', 'Dead card contains no valid tags', {
      field: 'tags',
      expected: 'At least one COLORNUMBER tag or NOTAG1',
    }));
  }
  if (!dateResult.date || hasErrors(issues)) return failed(issues, metadata);
  const record: DeadRecord = {
    date: dateResult.date,
    tags,
    note: noteValue,
    id: card.id,
    idList: card.idList,
    cardName: card.name,
    dateLastActivity: card.dateLastActivity,
    issues,
    metadata,
  };
  return succeeded(record, issues, metadata);
}

export function parseTagColorsCard(
  card: LivestockCardSource | null | undefined,
): ParseResult<TagColors> {
  if (!card) {
    return failed([issue('config-card-missing', 'Tag Colors config card is missing', {
      field: 'Tag Colors',
    })]);
  }
  const metadata = metadataFor(card);
  let raw: unknown;
  try {
    raw = JSON.parse(card.desc || '');
  } catch (error) {
    return failed([issue('invalid-config-json', `Tag Colors contains invalid JSON: ${String(error)}`, {
      field: 'Tag Colors',
      expected: 'A JSON object mapping color names to CSS hex colors',
    })], metadata);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return failed([issue('invalid-config-value', 'Tag Colors must be a JSON object', {
      field: 'Tag Colors',
      expected: '{ "RED": "#FF0000" }',
    })], metadata);
  }
  const colors: TagColors = {};
  const issues: ParseIssue[] = [];
  for (const [rawName, rawValue] of Object.entries(raw)) {
    const name = rawName.trim().toUpperCase();
    if (!name || !/^[A-Z][A-Z0-9_-]*$/.test(name)) {
      issues.push(issue('invalid-config-value', `Invalid Tag Colors key "${rawName}"`, {
        field: rawName,
        expected: 'A non-empty color name containing letters, numbers, underscores, or dashes',
      }));
      continue;
    }
    if (typeof rawValue !== 'string' || !/^#[0-9A-F]{6}$/i.test(rawValue)) {
      issues.push(issue('invalid-config-value', `Invalid CSS color for "${rawName}"`, {
        field: rawName,
        expected: 'A six-digit CSS hex color such as #FF0000',
      }));
      continue;
    }
    colors[name] = rawValue.toUpperCase();
  }
  if (Object.keys(colors).length === 0) {
    issues.push(issue('invalid-config-value', 'Tag Colors contains no valid colors', {
      field: 'Tag Colors',
    }));
  }
  if (hasErrors(issues)) return failed(issues, metadata);
  return succeeded(colors, issues, metadata);
}

export function parseTreatmentTypesCard(
  card: LivestockCardSource | null | undefined,
): ParseResult<TreatmentType[]> {
  if (!card) {
    return failed([issue('config-card-missing', 'Treatment Types config card is missing', {
      field: 'Treatment Types',
    })]);
  }
  const metadata = metadataFor(card);
  let raw: unknown;
  try {
    raw = JSON.parse(card.desc || '');
  } catch (error) {
    return failed([issue('invalid-config-json', `Treatment Types contains invalid JSON: ${String(error)}`, {
      field: 'Treatment Types',
      expected: '[{ "code": "Dr", "name": "Example treatment" }]',
    })], metadata);
  }
  if (!Array.isArray(raw)) {
    return failed([issue('invalid-config-value', 'Treatment Types must be a JSON array', {
      field: 'Treatment Types',
      expected: '[{ "code": "Dr", "name": "Example treatment" }]',
    })], metadata);
  }
  const types: TreatmentType[] = [];
  const issues: ParseIssue[] = [];
  const codes = new Set<string>();
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push(issue('invalid-config-value', `Treatment Types item ${index} is not an object`, {
        field: `Treatment Types[${index}]`,
      }));
      return;
    }
    const code = 'code' in entry && typeof entry.code === 'string' ? entry.code.trim() : '';
    const name = 'name' in entry && typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!code || /[\s:]/.test(code)) {
      issues.push(issue('invalid-config-value', `Invalid Treatment Types code at item ${index}`, {
        field: `Treatment Types[${index}].code`,
        expected: 'A non-empty code with no spaces or colons',
      }));
      return;
    }
    if (!name) {
      issues.push(issue('invalid-config-value', `Missing Treatment Types name at item ${index}`, {
        field: `Treatment Types[${index}].name`,
      }));
      return;
    }
    if (codes.has(code)) {
      issues.push(issue('invalid-config-value', `Duplicate Treatment Types code "${code}"`, {
        field: `Treatment Types[${index}].code`,
      }));
      return;
    }
    codes.add(code);
    types.push({ code, name });
  });
  if (types.length === 0) {
    issues.push(issue('invalid-config-value', 'Treatment Types contains no valid entries', {
      field: 'Treatment Types',
    }));
  }
  if (hasErrors(issues)) return failed(issues, metadata);
  return succeeded(types, issues, metadata);
}

export function incomingCardToRecord(c: TrelloCard): IncomingRecord | ErrorRecord {
  const result = parseIncomingCard(c);
  return result.ok ? result.record : errorRecordFor(result);
}

export function treatmentCardToRecord(c: TrelloCard): TreatmentRecord | ErrorRecord {
  const result = parseTreatmentCard(c);
  return result.ok ? result.record : errorRecordFor(result);
}

export function deadCardToRecord(c: TrelloCard): DeadRecord | ErrorRecord {
  const result = parseDeadCard(c);
  return result.ok ? result.record : errorRecordFor(result);
}

export type FetchRecordsOptions = {
  organizationId?: string;
  parseOptions?: RecordParseOptions;
  includeConfig?: boolean;
  optional?: boolean;
};

function emptyBoardList(name: LivestockListName) {
  return { id: '', idBoard: '', name, cards: [] as TrelloCard[] };
}

type LivestockTrelloClient = client.Client & {
  findBoardidByNameIfExists?: (name: string, organizationId?: string) => Promise<string | null>;
  findBoardidByName: (name: string, organizationId?: string) => Promise<string>;
};

async function resolveLivestockBoardId(
  trello: client.Client,
  options: FetchRecordsOptions,
): Promise<string | null> {
  const lookup = trello as LivestockTrelloClient;
  if (typeof lookup.findBoardidByNameIfExists === 'function') {
    const found = await lookup.findBoardidByNameIfExists('Livestock', options.organizationId);
    if (found) return found;
    if (options.optional) return null;
    throw new Error('ERROR: could not find Livestock board in Trello');
  }
  try {
    return await lookup.findBoardidByName('Livestock', options.organizationId);
  } catch (error) {
    if (options.optional) return null;
    throw error;
  }
}

export async function fetchRecords(
  trello: client.Client,
  options?: Omit<FetchRecordsOptions, 'optional'> & { optional?: false },
): Promise<LivestockRecords>;
export async function fetchRecords(
  trello: client.Client,
  options: FetchRecordsOptions & { optional: true },
): Promise<LivestockRecords | null>;
export async function fetchRecords(
  trello: client.Client,
  options: FetchRecordsOptions = {},
): Promise<LivestockRecords | null> {
  const includeConfig = options.includeConfig !== false;
  const livestockboardid = await resolveLivestockBoardId(trello, options);
  if (!livestockboardid) {
    if (options.optional) return null;
    throw new Error('ERROR: could not find Livestock board in Trello');
  }
  const foundLists = await trello.findListsAndCardsOnBoard({
    boardid: livestockboardid,
    listnames: ['Dead', 'Treatments', 'Incoming', 'Config'],
  });
  const findList = (name: LivestockListName) => {
    const found = foundLists.find(list => list.name === name);
    if (found) return found;
    if (options.optional) return emptyBoardList(name);
    throw new Error(`ERROR: could not find ${name} list in Livestock board`);
  };
  const incomingList = findList('Incoming');
  const treatmentList = findList('Treatments');
  const deadList = findList('Dead');
  const configList = findList('Config');
  const listMetadata = {
    Incoming: { id: incomingList.id, name: 'Incoming' as const },
    Treatments: { id: treatmentList.id, name: 'Treatments' as const },
    Dead: { id: deadList.id, name: 'Dead' as const },
    Config: { id: configList.id, name: 'Config' as const },
  };
  const result: LivestockRecords = {
    dead: { records: [], errors: [], issues: [], list: listMetadata.Dead },
    incoming: { records: [], errors: [], issues: [], list: listMetadata.Incoming },
    treatments: { records: [], errors: [], issues: [], list: listMetadata.Treatments },
    tagcolors: options.parseOptions?.tagColors || {},
    treatmentTypes: options.parseOptions?.treatmentTypes || [],
    listIds: {
      dead: deadList.id,
      incoming: incomingList.id,
      treatments: treatmentList.id,
      config: configList.id,
    },
    lists: listMetadata,
    issues: [],
  };

  let parseOptions: RecordParseOptions = {
    tagColors: options.parseOptions?.tagColors,
    treatmentTypes: options.parseOptions?.treatmentTypes,
  };
  if (includeConfig) {
    const configCards = configList.cards || [];
    const colorsResult = parseTagColorsCard(configCards.find(card => card.name === 'Tag Colors'));
    const typesResult = parseTreatmentTypesCard(configCards.find(card => card.name === 'Treatment Types'));
    const configIssues = [
      ...contextualizeIssues(colorsResult.issues, 'Config', colorsResult.metadata),
      ...contextualizeIssues(typesResult.issues, 'Config', typesResult.metadata),
    ];
    if (colorsResult.ok) result.tagcolors = colorsResult.record;
    if (typesResult.ok) result.treatmentTypes = typesResult.record;
    const config: LivestockConfig = {
      tagColors: result.tagcolors,
      treatmentTypes: result.treatmentTypes || [],
      issues: configIssues,
      cards: {
        tagColors: colorsResult.metadata,
        treatmentTypes: typesResult.metadata,
      },
    };
    result.config = config;
    result.issues!.push(...configIssues);
    parseOptions = {
      tagColors: colorsResult.ok ? colorsResult.record : parseOptions.tagColors,
      treatmentTypes: typesResult.ok ? typesResult.record : parseOptions.treatmentTypes,
    };
  }
  const parseList = <T extends object>(
    listName: LivestockListName,
    cards: TrelloCard[],
    parser: (card: TrelloCard, options: RecordParseOptions) => ParseResult<T>,
    section: { records: T[]; errors: ErrorRecord[]; issues?: ParseIssue[] },
  ) => {
    for (const card of cards) {
      const parsed = parser(card, parseOptions);
      const contextualIssues = contextualizeIssues(parsed.issues, listName, parsed.metadata);
      section.issues!.push(...contextualIssues);
      result.issues!.push(...contextualIssues);
      if (parsed.ok) {
        section.records.push({ ...parsed.record, issues: contextualIssues });
      } else {
        section.errors.push(errorRecordFor({ ...parsed, issues: contextualIssues }));
      }
    }
  };

  parseList('Incoming', incomingList.cards || [], parseIncomingCard, result.incoming);
  parseList('Treatments', treatmentList.cards || [], parseTreatmentCard, result.treatments);
  parseList('Dead', deadList.cards || [], parseDeadCard, result.dead);
  result.indexes = buildLivestockIndexes(result);
  return result;
}

function dedupeById<T extends { id?: string }>(records: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const record of records) {
    if (record.id) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
    }
    result.push(record);
  }
  return result;
}

export function mergeLivestockRecords(
  live: LivestockRecords,
  archives: LivestockRecords[],
): LivestockRecords {
  const merged: LivestockRecords = {
    dead: {
      records: dedupeById([
        ...live.dead.records,
        ...archives.flatMap(archive => archive.dead.records),
      ]),
      errors: dedupeById([
        ...live.dead.errors,
        ...archives.flatMap(archive => archive.dead.errors),
      ]),
      issues: [
        ...(live.dead.issues || []),
        ...archives.flatMap(archive => archive.dead.issues || []),
      ],
      list: live.dead.list,
    },
    incoming: {
      records: dedupeById([
        ...live.incoming.records,
        ...archives.flatMap(archive => archive.incoming.records),
      ]),
      errors: dedupeById([
        ...live.incoming.errors,
        ...archives.flatMap(archive => archive.incoming.errors),
      ]),
      issues: [
        ...(live.incoming.issues || []),
        ...archives.flatMap(archive => archive.incoming.issues || []),
      ],
      list: live.incoming.list,
    },
    treatments: {
      records: dedupeById([
        ...live.treatments.records,
        ...archives.flatMap(archive => archive.treatments.records),
      ]),
      errors: dedupeById([
        ...live.treatments.errors,
        ...archives.flatMap(archive => archive.treatments.errors),
      ]),
      issues: [
        ...(live.treatments.issues || []),
        ...archives.flatMap(archive => archive.treatments.issues || []),
      ],
      list: live.treatments.list,
    },
    tagcolors: live.tagcolors,
    treatmentTypes: live.treatmentTypes,
    config: live.config,
    listIds: live.listIds,
    lists: live.lists,
    issues: [
      ...(live.issues || []),
      ...archives.flatMap(archive => archive.issues || []),
    ],
  };
  merged.indexes = buildLivestockIndexes(merged);
  return merged;
}
