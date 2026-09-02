import {
  fetchRecords,
  mergeLivestockRecords,
  parseDeadCard,
  parseIncomingCard,
  parseTagColorsCard,
  parseTreatmentCard,
  parseTreatmentTypesCard,
  serializeDeadRecord,
  serializeIncomingRecord,
  serializeTreatmentRecord,
  tokenizeTreatmentProtocol,
} from '../records.js';
import {
  buildLivestockIndexes,
  buildTagGroupIndex,
  findDuplicateDeath,
  groupForTagInIndex,
} from '../util.js';
import {
  removeDeathTag,
  removeTreatmentTag,
  repairCardName,
  repairConfigCardDescription,
  resolveTrelloCardUrl,
  updateTreatmentRecord,
  upsertDeath,
  upsertTreatment,
  validateCardNameRepair,
  validateConfigCardDescriptionRepair,
} from '../mutations.js';
import {
  computeDeadAnalytics,
  computeTreatmentsAnalytics,
  listGroupDeathDays,
  listGroupTreatmentDays,
} from '../analytics.js';
import type {
  DeadRecord,
  IncomingRecord,
  LivestockRecords,
  ParseIssueCode,
  ParseResult,
  TreatmentRecord,
} from '../types.js';
import {
  configCards,
  fixtureCard,
  historicalGroupCards,
  invalidCards,
  tagColors,
  treatmentTypes,
  validCards,
} from './fixtures.js';

type Test = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: Test[] = [];

function test(name: string, run: Test['run']): void {
  tests.push({ name, run });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function parsed<T>(result: ParseResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected parse success, got: ${result.issues.map(current => current.message).join('; ')}`);
  }
  return result.record;
}

function expectIssue<T>(result: ParseResult<T>, code: ParseIssueCode): void {
  assert(!result.ok, `Expected ${code} parse failure`);
  assert(result.issues.some(current => current.code === code), `Expected issue code ${code}`);
}

function coreIncoming(record: IncomingRecord): unknown {
  return {
    date: record.date,
    groupname: record.groupname,
    into: record.into,
    weight: record.weight,
    head: record.head,
    tags: record.tags,
  };
}

function coreTreatment(record: TreatmentRecord): unknown {
  return { date: record.date, treatment: record.treatment, tags: record.tags };
}

function coreDead(record: DeadRecord): unknown {
  return { date: record.date, tags: record.tags, note: record.note };
}

function jsonEqual(actual: unknown, expected: unknown, message: string): void {
  equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

function makeRecords(
  incoming: IncomingRecord[],
  treatments: TreatmentRecord[] = [],
  dead: DeadRecord[] = [],
): LivestockRecords {
  const records: LivestockRecords = {
    incoming: { records: incoming, errors: [] },
    treatments: { records: treatments, errors: [] },
    dead: { records: dead, errors: [] },
    tagcolors: tagColors,
    treatmentTypes,
    listIds: {
      incoming: 'list-incoming',
      treatments: 'list-treatments',
      dead: 'list-dead',
      config: 'list-config',
    },
  };
  records.indexes = buildLivestockIndexes(records);
  return records;
}

test('parser/serializer pairs round trip canonical records', () => {
  const incoming = parsed(parseIncomingCard(validCards.incoming, { tagColors }));
  const incomingRoundTrip = parsed(parseIncomingCard(
    { ...validCards.incoming, name: serializeIncomingRecord(incoming) },
    { tagColors },
  ));
  jsonEqual(coreIncoming(incomingRoundTrip), coreIncoming(incoming), 'Incoming round trip');

  const treatment = parsed(parseTreatmentCard(validCards.treatment, { tagColors, treatmentTypes }));
  const treatmentRoundTrip = parsed(parseTreatmentCard(
    { ...validCards.treatment, name: serializeTreatmentRecord(treatment) },
    { tagColors, treatmentTypes },
  ));
  jsonEqual(coreTreatment(treatmentRoundTrip), coreTreatment(treatment), 'Treatment round trip');

  const deadResult = parseDeadCard(validCards.dead, { tagColors });
  const dead = parsed(deadResult);
  assert(deadResult.ok && deadResult.issues.some(current => current.code === 'legacy-dead-text'), 'Dead legacy text warning');
  assert(deadResult.ok && deadResult.issues.some(current => current.code === 'legacy-date-normalized'), 'Dead legacy date warning');
  const deadRoundTrip = parsed(parseDeadCard(
    { ...validCards.dead, name: serializeDeadRecord(dead) },
    { tagColors },
  ));
  jsonEqual(coreDead(deadRoundTrip), coreDead(dead), 'Dead round trip');
});

test('invalid cards are classified by field and issue code', () => {
  expectIssue(parseIncomingCard(invalidCards.incomingFormat, { tagColors }), 'invalid-card-format');
  expectIssue(parseIncomingCard(invalidCards.incomingDate, { tagColors }), 'invalid-date');
  expectIssue(parseIncomingCard(invalidCards.incomingHead, { tagColors }), 'invalid-number');
  expectIssue(parseIncomingCard(invalidCards.incomingRange, { tagColors }), 'invalid-tag-range');
  expectIssue(parseTreatmentCard(invalidCards.treatmentDate, { tagColors, treatmentTypes }), 'invalid-date');
  expectIssue(parseTreatmentCard(invalidCards.treatmentTag, { tagColors, treatmentTypes }), 'invalid-tag');
  expectIssue(parseDeadCard(invalidCards.deadDate, { tagColors }), 'invalid-date');
  expectIssue(parseDeadCard(invalidCards.deadTags, { tagColors }), 'missing-required-field');
  expectIssue(parseTagColorsCard(invalidCards.configJson), 'invalid-config-json');
  expectIssue(parseTreatmentTypesCard(invalidCards.configValue), 'invalid-config-value');
});

test('Treatment Types tokenizer uses longest matching code first', () => {
  const tokenized = tokenizeTreatmentProtocol('ZaNoExZNE', treatmentTypes);
  jsonEqual(
    tokenized.tokens.map(token => token.code),
    ['Za', 'No', 'Ex', 'Z', 'N', 'E'],
    'Overlapping treatment codes',
  );
  equal(tokenized.unknown.length, 0, 'No tokenizer leftovers');
});
test('historical tag colors and treatment codes remain valid identifiers', () => {
  const incoming = parsed(parseIncomingCard(invalidCards.incomingColor, { tagColors }));
  equal(incoming.tags?.[0]?.start.color, 'PURPLE', 'Historical incoming color retained');

  const treatmentResult = parseTreatmentCard(
    invalidCards.treatmentProtocol,
    { tagColors, treatmentTypes },
  );
  const treatment = parsed(treatmentResult);
  equal(treatment.treatment, 'ZaQ', 'Unknown treatment protocol retained');
  assert(
    treatmentResult.ok
    && !treatmentResult.issues.some(current => current.code === 'unknown-treatment-code'),
    'Unknown treatment code is not a parser issue',
  );
  const tokenized = tokenizeTreatmentProtocol(treatment.treatment, treatmentTypes);
  equal(tokenized.unknown[0]?.text, 'Q', 'Tokenizer still identifies unknown protocol text');

  const deadResult = parseDeadCard(invalidCards.deadColor, { tagColors });
  const dead = parsed(deadResult);
  equal(dead.tags[0]?.color, 'PURPLE', 'Historical Dead color retained');
  assert(
    deadResult.ok && !deadResult.issues.some(current => current.code === 'unknown-tag-color'),
    'Unconfigured tag color is not a parser issue',
  );
});

test('historical tag reuse resolves to the latest group not after event date', () => {
  const groups = historicalGroupCards.map(card => parsed(parseIncomingCard(card, { tagColors })));
  const groupsByName = Object.fromEntries(groups.map(group => [group.groupname, group]));
  const index = buildTagGroupIndex(groups);
  const oldGroup = groupForTagInIndex(
    index,
    groupsByName,
    { color: 'RED', number: 1 },
    '2023-06-01',
  );
  equal(
    oldGroup && oldGroup.groupname,
    'TEST:JAN23-1',
    'Old group resolution',
  );
  const newGroup = groupForTagInIndex(
    index,
    groupsByName,
    { color: 'RED', number: 1 },
    '2024-06-01',
  );
  equal(
    newGroup && newGroup.groupname,
    'TEST:JAN24-1',
    'Reused group resolution',
  );
});

test('duplicate death detection honors the current fourteen-day guard', () => {
  const existing = parsed(parseDeadCard(
    fixtureCard('dead-existing', 'list-dead', '2024-02-01: RED1'),
    { tagColors },
  ));
  const duplicate = findDuplicateDeath([existing], { color: 'RED', number: 1 }, '2024-02-15');
  assert(duplicate && duplicate.daysApart === 14, 'Expected duplicate at fourteen days');
  equal(
    findDuplicateDeath([existing], { color: 'RED', number: 1 }, '2024-02-16'),
    false,
    'Fifteen-day death is not duplicate',
  );
  const untagged = parsed(parseDeadCard(
    fixtureCard('dead-untagged', 'list-dead', '2024-02-01: NOTAG1'),
    { tagColors },
  ));
  equal(
    findDuplicateDeath([untagged], { color: 'NOTAG', number: 1 }, '2024-02-01'),
    false,
    'Untagged deaths have no stable identity and are never duplicates',
  );
});

test('fetchRecords preserves valid cards while aggregating config and card issues', async () => {
  const fake = {
    findBoardidByName: async () => 'board-livestock',
    findListsAndCardsOnBoard: async () => [
      { id: 'list-incoming', idBoard: 'board-livestock', name: 'Incoming', cards: [validCards.incoming] },
      {
        id: 'list-treatments',
        idBoard: 'board-livestock',
        name: 'Treatments',
        cards: [validCards.treatment, invalidCards.treatmentTag],
      },
      { id: 'list-dead', idBoard: 'board-livestock', name: 'Dead', cards: [validCards.dead] },
      {
        id: 'list-config',
        idBoard: 'board-livestock',
        name: 'Config',
        cards: [configCards.tagColors, configCards.treatmentTypes],
      },
    ],
  } as unknown as Parameters<typeof fetchRecords>[0];
  const records = await fetchRecords(fake);
  assert(records, 'fetchRecords returned livestock records');
  equal(records.listIds?.dead, 'list-dead', 'Dead list ID');
  equal(records.treatmentTypes?.length, treatmentTypes.length, 'Treatment Types loaded');
  equal(records.treatments.records.length, 1, 'Valid treatment retained');
  equal(records.treatments.errors.length, 1, 'Invalid treatment isolated');
  assert(records.issues?.some(current => current.code === 'invalid-tag'), 'Aggregated invalid tag issue');
  assert(records.indexes, 'Indexes returned from fetchRecords');
});

function fakeMutationClient(writes: { path: string; name: string; closed?: boolean }[]) {
  const respond = (path: string, params: { name?: string; idList?: string; closed?: boolean }) => {
    writes.push({ path, name: params.name || '', closed: params.closed });
    const id = path === '/cards' ? `created-${writes.length}` : path.split('/').pop() || 'updated';
    return [fixtureCard(id, params.idList || 'list-unknown', params.name || 'closed')];
  };
  return {
    put: async (path: string, params: { name?: string; idList?: string; closed?: boolean }) => respond(path, params),
    post: async (path: string, params: { name?: string; idList?: string }) => respond(path, params),
  } as unknown as Parameters<typeof upsertTreatment>[0];
}

test('treatment saves merge once and remain idempotent', async () => {
  const existing = parsed(parseTreatmentCard(
    fixtureCard('treatment-existing', 'list-treatments', '2024-02-01: Za: RED1'),
    { tagColors, treatmentTypes },
  ));
  const records = makeRecords([], [existing]);
  const writes: { path: string; name: string }[] = [];
  const client = fakeMutationClient(writes);
  const unchanged = await upsertTreatment(client, records, {
    date: '2024-02-01',
    treatment: 'Za',
    tag: { color: 'RED', number: 1 },
  });
  equal(unchanged.status, 'unchanged', 'Duplicate treatment status');
  equal(writes.length, 0, 'Duplicate treatment performs no write');
  const merged = await upsertTreatment(client, records, {
    date: '2024-02-01',
    treatment: 'Za',
    tag: { color: 'YELLOW', number: 2 },
  });
  equal(merged.status, 'updated', 'Merged treatment status');
  equal(merged.record.tags.length, 2, 'Merged treatment tags');
  equal(writes.length, 1, 'Treatment merged with one write');
});

test('death saves merge by date and block near-date duplicates', async () => {
  const existing = parsed(parseDeadCard(
    fixtureCard('dead-existing', 'list-dead', '2024-02-01: RED1'),
    { tagColors },
  ));
  const records = makeRecords([], [], [existing]);
  const writes: { path: string; name: string }[] = [];
  const client = fakeMutationClient(writes);
  const duplicate = await upsertDeath(client, records, {
    date: '2024-02-10',
    tag: { color: 'RED', number: 1 },
  });
  equal(duplicate.status, 'duplicate', 'Duplicate death status');
  equal(writes.length, 0, 'Duplicate death performs no write');
  const merged = await upsertDeath(client, records, {
    date: '2024-02-01',
    tag: { color: 'YELLOW', number: 2 },
  });
  equal(merged.status, 'updated', 'Merged death status');
  equal(merged.record.tags.length, 2, 'Merged death tags');
  equal(writes.length, 1, 'Death merged with one write');
});

test('card repair requires a changed name that parses before writing', async () => {
  const invalid = validateCardNameRepair({
    kind: 'treatment',
    card: invalidCards.treatmentTag,
    newName: 'still invalid',
    options: { tagColors, treatmentTypes },
  });
  equal(invalid.valid, false, 'Invalid repair rejected');
  const newName = '2024-02-01: Za: RED1';
  const valid = validateCardNameRepair({
    kind: 'treatment',
    card: invalidCards.treatmentTag,
    newName,
    options: { tagColors, treatmentTypes },
  });
  equal(valid.valid, true, 'Valid repair accepted');
  const writes: { path: string; name: string }[] = [];
  const repaired = await repairCardName(fakeMutationClient(writes), {
    kind: 'treatment',
    card: invalidCards.treatmentTag,
    newName,
    options: { tagColors, treatmentTypes },
  });
  equal(repaired.cardName, newName, 'Repaired card reparsed');
  equal(writes.length, 1, 'Repair performs one explicit write');
  const trelloUrl = 'https://trello.com/c/Sanitized';
  const linked = parsed(parseTreatmentCard({
    ...validCards.treatment,
    shortUrl: trelloUrl,
  }, { tagColors, treatmentTypes }));
  equal(linked.metadata?.trelloUrl, trelloUrl, 'Documented Trello URL retained in metadata');
  const urlClient = {
    get: async () => [{
      ...validCards.treatment,
      shortUrl: trelloUrl,
    }],
  } as unknown as Parameters<typeof resolveTrelloCardUrl>[0];
  equal(
    await resolveTrelloCardUrl(urlClient, validCards.treatment.id),
    trelloUrl,
    'Trello URL resolved through generic get',
  );
});

test('config repair validates and saves a parseable Trello card description', async () => {
  const invalid = validateConfigCardDescriptionRepair({
    kind: 'tagColors',
    card: invalidCards.configJson,
    newDescription: '{still invalid',
  });
  equal(invalid.valid, false, 'Invalid config repair rejected');
  const newDescription = JSON.stringify({ RED: '#FF0000' });
  const valid = validateConfigCardDescriptionRepair({
    kind: 'tagColors',
    card: invalidCards.configJson,
    newDescription,
  });
  equal(valid.valid, true, 'Valid config repair accepted');
  const writes: { path: string; desc: string }[] = [];
  const client = {
    put: async (path: string, params: { desc: string }) => {
      writes.push({ path, desc: params.desc });
      return [{ ...invalidCards.configJson, desc: params.desc }];
    },
  } as unknown as Parameters<typeof repairConfigCardDescription>[0];
  const repaired = await repairConfigCardDescription(client, {
    kind: 'tagColors',
    card: invalidCards.configJson,
    newDescription,
  });
  assert(!Array.isArray(repaired), 'Tag Colors repair returns a color map');
  equal(repaired.RED, '#FF0000', 'Repaired config reparsed');
  equal(writes.length, 1, 'Config repair performs one explicit write');
});

test('analytics expose inclusions, exclusions, historical reuse, and missing denominators', () => {
  const incoming = historicalGroupCards.map(card => parsed(parseIncomingCard(card, { tagColors })));
  const treatments = [
    fixtureCard('t-old-1', 'list-treatments', '2023-02-01: Za: RED1'),
    fixtureCard('t-old-2', 'list-treatments', '2023-02-10: No: RED1'),
    fixtureCard('t-new', 'list-treatments', '2024-02-01: Za: RED1'),
    fixtureCard('t-yellow', 'list-treatments', '2024-02-02: Za: YELLOW2'),
    fixtureCard('t-unmatched', 'list-treatments', '2024-02-02: Za: BLACK9'),
    fixtureCard('t-notag', 'list-treatments', '2024-02-02: Za: NOTAG1'),
  ].map(card => parsed(parseTreatmentCard(card, { tagColors, treatmentTypes })));
  const dead = [
    fixtureCard('d-old', 'list-dead', '2023-03-01: RED1'),
    fixtureCard('d-new', 'list-dead', '2024-03-01: RED1'),
    fixtureCard('d-yellow', 'list-dead', '2024-03-01: YELLOW2'),
    fixtureCard('d-unmatched', 'list-dead', '2024-03-01: BLACK9'),
    fixtureCard('d-notag', 'list-dead', '2024-03-01: NOTAG1'),
  ].map(card => parsed(parseDeadCard(card, { tagColors })));
  const records = makeRecords(incoming, treatments, dead);
  const treatmentAnalytics = computeTreatmentsAnalytics(records);
  equal(treatmentAnalytics.events.total, 6, 'Treatment event total');
  equal(treatmentAnalytics.events.included, 4, 'Included treatments');
  equal(treatmentAnalytics.events.excluded, 2, 'Excluded treatments');
  equal(treatmentAnalytics.uniqueTreatedHead, 3, 'Historical identities remain distinct');
  assert(
    treatmentAnalytics.retreatmentRate.available
      && treatmentAnalytics.retreatmentRate.value === 1 / 3,
    'Retreatment rate',
  );
  const noHeadTreatmentGroup = treatmentAnalytics.groups.find(
    group => group.group.groupname === 'TEST:JAN24-1',
  );
  assert(noHeadTreatmentGroup && !noHeadTreatmentGroup.treatmentRate.available, 'Missing treatment denominator is unavailable');
  const historicalTreatmentGroup = treatmentAnalytics.groups.find(
    group => group.group.groupname === 'TEST:JAN23-1',
  );
  assert(historicalTreatmentGroup, 'Historical treatment group is present');
  equal(historicalTreatmentGroup.identifiedHead, 3, 'Enumerable historical head');
  equal(historicalTreatmentGroup.unidentifiableHead, 7, 'Unidentifiable historical head');
  const zeroTreatmentBucket = historicalTreatmentGroup.mortalityByTreatmentCount.find(
    bucket => bucket.treatmentCount === 0,
  );
  assert(zeroTreatmentBucket, 'Exact zero-treatment bucket exists');
  equal(zeroTreatmentBucket.identifiedHead, 2, 'Zero-treatment identified head');
  const zeroTreatmentGroup = treatmentAnalytics.groups.find(
    group => group.group.groupname === 'TEST:JAN24-3',
  );
  assert(zeroTreatmentGroup, 'Zero-treatment cohort is present');
  equal(zeroTreatmentGroup.treatmentEvents, 0, 'Zero-treatment cohort event count');
  equal(
    zeroTreatmentGroup.mortalityByTreatmentCount.find(bucket => bucket.treatmentCount === 0)?.identifiedHead,
    5,
    'Entire identifiable cohort is in exact zero-treatment bucket',
  );
  equal(
    treatmentAnalytics.weeklyByTreatmentCode
      .filter(current => current.treatmentCode === 'Za')
      .reduce((sum, current) => sum + current.count, 0),
    3,
    'Decoded weekly Za administrations',
  );
  equal(treatmentAnalytics.retreatmentGaps.intervalsIncluded, 1, 'Retreatment interval count');
  equal(treatmentAnalytics.retreatmentGaps.values[0]?.days, 9, 'Retreatment gap days');
  equal(treatmentAnalytics.retreatmentGaps.sourceEventsExcluded, 5, 'Retreatment source exclusions');

  const cureIncoming = parsed(parseIncomingCard(
    fixtureCard(
      'incoming-cure',
      'list-incoming',
      '2024-01-01: TEST:CURE; Head: 3; Tags: RED1-RED3;',
    ),
    { tagColors },
  ));
  const cureTreatments = [
    fixtureCard('t-cure-alive', 'list-treatments', '2024-01-10: Za: RED1'),
    fixtureCard('t-cure-dead', 'list-treatments', '2024-01-10: Za: RED2'),
    fixtureCard('t-cure-recent', 'list-treatments', '2024-02-25: Za: RED3'),
  ].map(card => parsed(parseTreatmentCard(card, { tagColors, treatmentTypes })));
  const cureDead = parsed(parseDeadCard(
    fixtureCard('d-cure', 'list-dead', '2024-02-01: RED2'),
    { tagColors },
  ));
  const cureGroup = computeTreatmentsAnalytics(
    makeRecords([cureIncoming], cureTreatments, [cureDead]),
    { endDate: '2024-03-01' },
  ).groups[0];
  assert(cureGroup, 'Cure analytics group is present');
  equal(cureGroup.cureEligibleHead, 2, 'Only treatments with 30 days of follow-up are cure eligible');
  equal(cureGroup.curedHead, 1, 'Eligible calf without a death is cured');
  assert(
    cureGroup.cureRate.available && cureGroup.cureRate.value === 0.5,
    'Cure rate uses eligible treated calves as its denominator',
  );

  const deadAnalytics = computeDeadAnalytics(records);
  equal(deadAnalytics.deaths.total, 5, 'Death total');
  equal(deadAnalytics.deaths.included, 3, 'Included deaths');
  equal(deadAnalytics.deaths.excluded, 2, 'Excluded deaths');
  equal(deadAnalytics.deaths.reasons.notag, 1, 'NOTAG exclusion');
  equal(deadAnalytics.deaths.reasons.unmatchedGroup, 1, 'Unmatched exclusion');
  equal(deadAnalytics.deaths.denominatorExcluded, 1, 'Missing head denominator exclusion');
  assert(!deadAnalytics.mortalityRate.available, 'Overall mortality unavailable with missing head');
  const noHeadDeadGroup = deadAnalytics.groups.find(
    group => group.group.groupname === 'TEST:JAN24-1',
  );
  assert(noHeadDeadGroup && !noHeadDeadGroup.mortalityRate.available, 'Group mortality denominator unavailable');
  const zeroDeathGroup = deadAnalytics.groups.find(
    group => group.group.groupname === 'TEST:JAN24-3',
  );
  assert(zeroDeathGroup, 'Zero-death cohort is present');
  equal(zeroDeathGroup.deaths, 0, 'Zero-death cohort count');
  assert(
    zeroDeathGroup.mortalityRate.available && zeroDeathGroup.mortalityRate.value === 0,
    'Zero-death cohort has zero mortality with a valid denominator',
  );
  equal(deadAnalytics.daysOnFeedDistribution.deathsIncluded, 3, 'Days-on-feed included deaths');
  equal(deadAnalytics.daysOnFeedDistribution.deathsExcluded, 2, 'Days-on-feed excluded deaths');
  equal(deadAnalytics.lastTreatmentToDeath.intervalsIncluded, 3, 'Last-treatment interval count');
  equal(deadAnalytics.lastTreatmentToDeath.deathsExcluded, 2, 'Last-treatment exclusions');

  const untreatedIncoming = parsed(parseIncomingCard(
    fixtureCard(
      'incoming-untreated',
      'list-incoming',
      '2024-01-01: TEST:UNTREATED; Head: 2; Tags: RED1-RED2;',
    ),
    { tagColors },
  ));
  const untreatedTreatment = parsed(parseTreatmentCard(
    fixtureCard('t-untreated', 'list-treatments', '2024-01-10: Za: RED1'),
    { tagColors, treatmentTypes },
  ));
  const untreatedDeaths = [
    fixtureCard('d-treated', 'list-dead', '2024-02-01: RED1'),
    fixtureCard('d-untreated', 'list-dead', '2024-02-01: RED2'),
  ].map(card => parsed(parseDeadCard(card, { tagColors })));
  const untreatedGroup = computeDeadAnalytics(
    makeRecords([untreatedIncoming], [untreatedTreatment], untreatedDeaths),
  ).groups[0];
  assert(untreatedGroup, 'Untreated-before-death group is present');
  equal(untreatedGroup.treatedHead, 1, 'Unique treated head is counted by group');
  assert(
    untreatedGroup.treatmentRate.available && untreatedGroup.treatmentRate.value === 0.5,
    'Group treatment rate uses incoming head',
  );
  equal(untreatedGroup.untreatedBeforeDeath, 1, 'Death without a prior treatment is counted');
  assert(
    untreatedGroup.shareUntreatedBeforeDeath.available
      && untreatedGroup.shareUntreatedBeforeDeath.value === 0.5,
    'Untreated-before-death share uses group deaths',
  );

  const completeCohortRecords = makeRecords(
    incoming.filter(group => (
      group.groupname === 'TEST:JAN23-1' || group.groupname === 'TEST:JAN24-2'
    )),
    treatments,
    [dead[0]!],
  );
  const completeCohortAnalytics = computeDeadAnalytics(completeCohortRecords, {
    groupnames: ['TEST:JAN23-1', 'TEST:JAN24-2'],
  });
  equal(completeCohortAnalytics.groups.length, 2, 'Selected zero-death cohort remains in group results');
  assert(
    completeCohortAnalytics.mortalityRate.available
      && completeCohortAnalytics.mortalityRate.value === 1 / 30,
    'Overall mortality uses all selected cohort head',
  );
  const missingCohortAnalytics = computeDeadAnalytics(completeCohortRecords, {
    groupnames: ['TEST:JAN23-1', 'MISSING:GROUP'],
  });
  assert(!missingCohortAnalytics.mortalityRate.available, 'Missing selected cohort makes denominator unavailable');
});

test('merged archive incoming groups keep historical tag identities distinct', () => {
  const liveIncoming = parsed(parseIncomingCard(historicalGroupCards[1]!, { tagColors }));
  const archiveIncoming = parsed(parseIncomingCard(historicalGroupCards[0]!, { tagColors }));
  const liveTreatment = parsed(parseTreatmentCard(
    fixtureCard('t-live', 'list-treatments', '2024-02-01: Za: RED1'),
    { tagColors, treatmentTypes },
  ));
  const archiveTreatment = parsed(parseTreatmentCard(
    fixtureCard('t-archive', 'list-treatments', '2023-02-01: Za: RED1'),
    { tagColors, treatmentTypes },
  ));
  const live = makeRecords([liveIncoming], [liveTreatment]);
  const archive = makeRecords([archiveIncoming], [archiveTreatment]);
  const merged = mergeLivestockRecords(live, [archive]);
  equal(merged.listIds?.treatments, live.listIds?.treatments, 'Live list IDs are preserved');
  equal(merged.incoming.records.length, 2, 'Incoming groups are merged');
  const analytics = computeTreatmentsAnalytics(merged);
  equal(analytics.uniqueTreatedHead, 2, 'Reused tags in different groups stay distinct');
  const oldGroup = groupForTagInIndex(
    merged.indexes!.groupsByTag,
    merged.indexes!.groupsByName,
    { color: 'RED', number: 1 },
    '2023-06-01',
  );
  equal(oldGroup && oldGroup.groupname, 'TEST:JAN23-1', 'Archive group owns the 2023 tag');
});

test('treatment protocol rename updates the existing card name', async () => {
  const existing = parsed(parseTreatmentCard(
    fixtureCard('treatment-rename', 'list-treatments', '2024-02-01: Za: RED1 YELLOW2'),
    { tagColors, treatmentTypes },
  ));
  const records = makeRecords([], [existing]);
  const writes: { path: string; name: string; closed?: boolean }[] = [];
  const renamed = await updateTreatmentRecord(fakeMutationClient(writes), records, {
    record: existing,
    treatment: 'No',
  });
  equal(renamed.status, 'updated', 'Protocol rename status');
  equal(renamed.record.treatment, 'No', 'Protocol renamed');
  equal(writes.length, 1, 'Protocol rename performs one write');
  equal(writes[0]?.closed, undefined, 'Protocol rename does not close the card');
});

test('treatment protocol rename merges into an existing same-day card', async () => {
  const source = parsed(parseTreatmentCard(
    fixtureCard('treatment-source', 'list-treatments', '2024-02-01: Za: RED1'),
    { tagColors, treatmentTypes },
  ));
  const target = parsed(parseTreatmentCard(
    fixtureCard('treatment-target', 'list-treatments', '2024-02-01: No: YELLOW2'),
    { tagColors, treatmentTypes },
  ));
  const records = makeRecords([], [source, target]);
  const writes: { path: string; name: string; closed?: boolean }[] = [];
  const merged = await updateTreatmentRecord(fakeMutationClient(writes), records, {
    record: source,
    treatment: 'No',
  });
  equal(merged.status, 'updated', 'Merged protocol status');
  equal(merged.record.tags.length, 2, 'Merged protocol tags');
  equal(writes.length, 2, 'Merge writes target then closes source');
  equal(writes[1]?.closed, true, 'Source card is closed after merge');
});

test('removing a treatment tag updates or closes the card', async () => {
  const existing = parsed(parseTreatmentCard(
    fixtureCard('treatment-tags', 'list-treatments', '2024-02-01: Za: RED1 YELLOW2'),
    { tagColors, treatmentTypes },
  ));
  const records = makeRecords([], [existing]);
  const writes: { path: string; name: string; closed?: boolean }[] = [];
  const client = fakeMutationClient(writes);
  const updated = await removeTreatmentTag(client, records, {
    record: existing,
    tag: { color: 'RED', number: 1 },
  });
  equal(updated.status, 'updated', 'Tag removal status');
  equal(updated.record.tags.length, 1, 'Remaining treatment tags');
  const closed = await removeTreatmentTag(client, records, {
    record: updated.record,
    tag: { color: 'YELLOW', number: 2 },
  });
  equal(closed.status, 'closed', 'Last treatment tag closes the card');
  equal(writes[1]?.closed, true, 'Empty treatment card is closed');
});

test('removing a death tag updates or closes the card', async () => {
  const existing = parsed(parseDeadCard(
    fixtureCard('dead-tags', 'list-dead', '2024-02-01: RED1 YELLOW2'),
    { tagColors },
  ));
  const records = makeRecords([], [], [existing]);
  const writes: { path: string; name: string; closed?: boolean }[] = [];
  const client = fakeMutationClient(writes);
  const updated = await removeDeathTag(client, records, {
    record: existing,
    tag: { color: 'RED', number: 1 },
  });
  equal(updated.status, 'updated', 'Death tag removal status');
  equal(updated.record.tags.length, 1, 'Remaining death tags');
  const closed = await removeDeathTag(client, records, {
    record: updated.record,
    tag: { color: 'YELLOW', number: 2 },
  });
  equal(closed.status, 'closed', 'Last death tag closes the card');
  equal(writes[1]?.closed, true, 'Empty death card is closed');
});

test('group day lists keep reused tags distinct and annotate deaths', () => {
  const incoming = historicalGroupCards.map(card => parsed(parseIncomingCard(card, { tagColors })));
  const treatments = [
    fixtureCard('t-old-1', 'list-treatments', '2023-02-01: Za: RED1'),
    fixtureCard('t-old-2', 'list-treatments', '2023-02-10: No: RED1'),
    fixtureCard('t-new', 'list-treatments', '2024-02-01: Za: RED1'),
  ].map(card => parsed(parseTreatmentCard(card, { tagColors, treatmentTypes })));
  const dead = [
    fixtureCard('d-old', 'list-dead', '2023-03-01: RED1'),
    fixtureCard('d-new', 'list-dead', '2024-03-01: RED1'),
  ].map(card => parsed(parseDeadCard(card, { tagColors })));
  const records = makeRecords(incoming, treatments, dead);

  const oldTreatments = listGroupTreatmentDays(records, 'TEST:JAN23-1');
  equal(oldTreatments.length, 2, 'Historical group has two treatment days');
  equal(oldTreatments[0]?.date, '2023-02-10', 'Newest treatment day first');
  equal(oldTreatments[0]?.count, 1, 'One treated head on newest day');
  equal(oldTreatments[0]?.animals[0]?.treatmentCount, 2, 'Lifetime treatments in group');
  equal(oldTreatments[0]?.animals[0]?.deathDate, '2023-03-01', 'Historical death annotated');

  const newTreatments = listGroupTreatmentDays(records, 'TEST:JAN24-1');
  equal(newTreatments.length, 1, 'Reused tag is a separate 2024 identity');
  equal(newTreatments[0]?.animals[0]?.treatmentCount, 1, '2024 animal has one treatment');
  equal(newTreatments[0]?.animals[0]?.deathDate, '2024-03-01', '2024 death stays on 2024 identity');

  const filtered = listGroupTreatmentDays(records, 'TEST:JAN23-1', { startDate: '2023-02-10' });
  equal(filtered.length, 1, 'Date filter hides earlier treatment days');
  equal(filtered[0]?.animals[0]?.treatmentCount, 2, 'Filtered view still reports lifetime count');

  const oldDeaths = listGroupDeathDays(records, 'TEST:JAN23-1');
  equal(oldDeaths.length, 1, 'Historical group has one death day');
  equal(oldDeaths[0]?.animals[0]?.treatmentCount, 2, 'Death lists prior treatments');
  const newDeaths = listGroupDeathDays(records, 'TEST:JAN24-1');
  equal(newDeaths[0]?.animals[0]?.treatmentCount, 1, 'Reused tag death keeps 2024 treatments');
});

async function run(): Promise<void> {
  for (const current of tests) {
    await current.run();
    console.log(`PASS ${current.name}`);
  }
  console.log(`PASS ${tests.length} livestock unit tests`);
}

run().catch(error => {
  console.error(error);
  throw error;
});
