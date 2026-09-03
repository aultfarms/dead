import type {
  IncomingRecord,
  LivestockRecords,
  Tag,
  TreatmentRecord,
} from './types.js';
import { buildLivestockIndexes, calendarDate, groupForTagInIndex, tagKey } from './util.js';
import { tokenizeTreatmentProtocol } from './records.js';

export type AvailableMetric = {
  available: true;
  value: number;
};

export type UnavailableMetric = {
  available: false;
  value: null;
  reason: string;
};

export type NumericMetric = AvailableMetric | UnavailableMetric;

export type InclusionCounts = {
  total: number;
  included: number;
  excluded: number;
  denominatorExcluded: number;
  reasons: {
    notag: number;
    unmatchedGroup: number;
  };
};

export type AnalyticsFilters = {
  startDate?: string;
  endDate?: string;
  groupnames?: string[];
  protocols?: string[];
  treatmentCodes?: string[];
};

export type WeeklyCount = {
  week: string;
  count: number;
};

export type ProtocolCount = {
  protocol: string;
  count: number;
};
export type DayCount = {
  days: number;
  count: number;
};

export type WeeklyTreatmentCodeCount = {
  week: string;
  treatmentCode: string;
  treatmentName: string;
  count: number;
};

export type RetreatmentGapDistribution = {
  intervalsIncluded: number;
  sourceEventsExcluded: number;
  exclusionReasons: {
    firstTreatment: number;
    notag: number;
    unmatchedGroup: number;
  };
  values: DayCount[];
};

export type DaysOnFeedDistribution = {
  deathsIncluded: number;
  deathsExcluded: number;
  values: DayCount[];
};

export type LastTreatmentToDeathDistribution = {
  intervalsIncluded: number;
  deathsExcluded: number;
  exclusionReasons: {
    noPriorTreatment: number;
    notag: number;
    unmatchedGroup: number;
  };
  values: DayCount[];
};

export type TreatmentGroupAnalytics = {
  group: IncomingRecord;
  incomingHead: number | null;
  identifiedHead: number;
  unidentifiableHead: number | null;
  treatedHead: number;
  treatmentEvents: number;
  treatmentRate: NumericMetric;
  treatmentsPerTreatedAnimal: NumericMetric;
  cureEligibleHead: number;
  curedHead: number;
  cureRate: NumericMetric;
  observedDeaths: number;
  observedMortality: NumericMetric;
  mortalityByTreatmentCount: {
    treatmentCount: number;
    identifiedHead: number;
    deaths: number;
    observedMortality: NumericMetric;
  }[];
};

export type TreatmentsAnalytics = {
  events: InclusionCounts;
  uniqueTreatedHead: number;
  treatmentsPerTreatedAnimal: NumericMetric;
  retreatmentRate: NumericMetric;
  weekly: WeeklyCount[];
  weeklyByTreatmentCode: WeeklyTreatmentCodeCount[];
  protocols: ProtocolCount[];
  retreatmentGaps: RetreatmentGapDistribution;
  groups: TreatmentGroupAnalytics[];
};

export type DeadGroupAnalytics = {
  group: IncomingRecord;
  incomingHead: number | null;
  treatedHead: number;
  treatmentRate: NumericMetric;
  deaths: number;
  mortalityRate: NumericMetric;
  averageDaysOnFeedAtDeath: NumericMetric;
  treatedBeforeDeath: number;
  shareTreatedBeforeDeath: NumericMetric;
  untreatedBeforeDeath: number;
  shareUntreatedBeforeDeath: NumericMetric;
};

export type DeadAnalytics = {
  deaths: InclusionCounts;
  mortalityRate: NumericMetric;
  averageDaysOnFeedAtDeath: NumericMetric;
  treatedBeforeDeath: number;
  shareTreatedBeforeDeath: NumericMetric;
  weekly: WeeklyCount[];
  daysOnFeedDistribution: DaysOnFeedDistribution;
  lastTreatmentToDeath: LastTreatmentToDeathDistribution;
  groups: DeadGroupAnalytics[];
};

export type GroupDayAnimal = {
  color: string;
  number: number;
  protocol?: string;
  treatmentCount: number;
  deathDate?: string;
};

export type GroupDayBucket = {
  date: string;
  count: number;
  animals: GroupDayAnimal[];
};

type ResolvedTreatment = {
  record: TreatmentRecord;
  tag: Tag;
  group: IncomingRecord;
  identity: string;
};

function available(value: number): AvailableMetric {
  return { available: true, value };
}

function unavailable(reason: string): UnavailableMetric {
  return { available: false, value: null, reason };
}

function ratio(numerator: number, denominator: number | null, reason: string): NumericMetric {
  if (denominator === null || denominator <= 0) return unavailable(reason);
  return available(numerator / denominator);
}

function inDateRange(date: string, filters: AnalyticsFilters): boolean {
  if (filters.startDate && date < filters.startDate) return false;
  if (filters.endDate && date > filters.endDate) return false;
  return true;
}

function mondayFor(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const weekday = parsed.getUTCDay();
  parsed.setUTCDate(parsed.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return parsed.toISOString().slice(0, 10);
}

function countWeeks(dates: string[]): WeeklyCount[] {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const week = mondayFor(date);
    counts.set(week, (counts.get(week) || 0) + 1);
  }
  return [...counts].map(([week, count]) => ({ week, count }))
    .sort((left, right) => left.week.localeCompare(right.week));
}
function countDays(values: number[]): DayCount[] {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].map(([days, count]) => ({ days, count }))
    .sort((left, right) => left.days - right.days);
}

function daysBetween(earlier: string, later: string): number {
  const earlierTime = Date.parse(`${earlier}T00:00:00Z`);
  const laterTime = Date.parse(`${later}T00:00:00Z`);
  return Math.floor((laterTime - earlierTime) / 86400000);
}

function cohortUniverse(
  records: LivestockRecords,
  filters: AnalyticsFilters,
): { groups: IncomingRecord[]; missingGroupnames: string[] } {
  if (!filters.groupnames?.length) {
    return { groups: records.incoming.records, missingGroupnames: [] };
  }
  const selected = new Set(filters.groupnames);
  const groups = records.incoming.records.filter(group => selected.has(group.groupname));
  const found = new Set(groups.map(group => group.groupname));
  return {
    groups,
    missingGroupnames: filters.groupnames.filter(groupname => !found.has(groupname)),
  };
}

function enumerableIdentities(group: IncomingRecord): Set<string> {
  const identities = new Set<string>();
  for (const range of group.tags || []) {
    if (
      range.start.color.toUpperCase() !== range.end.color.toUpperCase()
      || !Number.isSafeInteger(range.start.number)
      || !Number.isSafeInteger(range.end.number)
      || range.start.number > range.end.number
    ) {
      continue;
    }
    for (let number = range.start.number; number <= range.end.number; number += 1) {
      identities.add(identityFor(group, { color: range.start.color, number }));
    }
  }
  return identities;
}

function emptyCounts(): InclusionCounts {
  return {
    total: 0,
    included: 0,
    excluded: 0,
    denominatorExcluded: 0,
    reasons: { notag: 0, unmatchedGroup: 0 },
  };
}

function identityFor(group: IncomingRecord, tag: Tag): string {
  return `${group.groupname}|${tagKey(tag)}`;
}

function recordMatchesTreatmentFilters(
  records: LivestockRecords,
  record: TreatmentRecord,
  filters: AnalyticsFilters,
): boolean {
  if (!inDateRange(record.date, filters)) return false;
  if (filters.protocols?.length && !filters.protocols.includes(record.treatment)) return false;
  if (filters.treatmentCodes?.length) {
    const tokenized = tokenizeTreatmentProtocol(record.treatment, records.treatmentTypes || []);
    const codes = new Set(tokenized.tokens.map(token => token.code));
    if (!filters.treatmentCodes.some(code => codes.has(code))) return false;
  }
  return true;
}

function treatmentEntries(
  records: LivestockRecords,
  filters: AnalyticsFilters,
): { included: ResolvedTreatment[]; counts: InclusionCounts } {
  const indexes = records.indexes || buildLivestockIndexes(records);
  const included: ResolvedTreatment[] = [];
  const counts = emptyCounts();
  for (const record of records.treatments.records) {
    if (!recordMatchesTreatmentFilters(records, record, filters)) continue;
    for (const tag of record.tags) {
      const group = tag.color.toUpperCase() === 'NOTAG'
        ? false
        : groupForTagInIndex(indexes.groupsByTag, indexes.groupsByName, tag, record.date);
      if (group && filters.groupnames?.length && !filters.groupnames.includes(group.groupname)) {
        continue;
      }
      counts.total += 1;
      if (tag.color.toUpperCase() === 'NOTAG') {
        counts.excluded += 1;
        counts.reasons.notag += 1;
      } else if (!group || calendarDate(record.date) < calendarDate(group.date)) {
        counts.excluded += 1;
        counts.reasons.unmatchedGroup += 1;
      } else {
        counts.included += 1;
        if (group.head === undefined) counts.denominatorExcluded += 1;
        included.push({ record, tag, group, identity: identityFor(group, tag) });
      }
    }
  }
  return { included, counts };
}

export function computeTreatmentsAnalytics(
  records: LivestockRecords,
  filters: AnalyticsFilters = {},
): TreatmentsAnalytics {
  const { included, counts } = treatmentEntries(records, filters);
  const treatmentsByAnimal = new Map<string, ResolvedTreatment[]>();
  const protocolCounts = new Map<string, number>();
  for (const entry of included) {
    const current = treatmentsByAnimal.get(entry.identity) || [];
    current.push(entry);
    treatmentsByAnimal.set(entry.identity, current);
    protocolCounts.set(entry.record.treatment, (protocolCounts.get(entry.record.treatment) || 0) + 1);
  }
  const uniqueTreatedHead = treatmentsByAnimal.size;
  const retreated = [...treatmentsByAnimal.values()].filter(entries => entries.length > 1).length;
  const indexes = records.indexes || buildLivestockIndexes(records);
  const asOfDate = filters.endDate || new Date().toISOString().slice(0, 10);
  const cohorts = cohortUniverse(records, filters);
  const entriesByGroup = new Map<string, ResolvedTreatment[]>();
  for (const entry of included) {
    const current = entriesByGroup.get(entry.group.id) || [];
    current.push(entry);
    entriesByGroup.set(entry.group.id, current);
  }
  const indexedDeaths = Object.values(indexes.deathsByTag).flat();
  const observedDeathsByGroup = new Map<string, typeof indexedDeaths>();
  const deathsAsOfByGroup = new Map<string, typeof indexedDeaths>();
  for (const death of indexedDeaths) {
    if (!death.group) continue;
    if (calendarDate(death.record.date) < calendarDate(death.group.date)) continue;
    const groupId = death.group.id;
    if (inDateRange(death.record.date, filters)) {
      const current = observedDeathsByGroup.get(groupId) || [];
      current.push(death);
      observedDeathsByGroup.set(groupId, current);
    }
    if (death.record.date <= asOfDate) {
      const current = deathsAsOfByGroup.get(groupId) || [];
      current.push(death);
      deathsAsOfByGroup.set(groupId, current);
    }
  }
  const groups: TreatmentGroupAnalytics[] = [];
  for (const group of cohorts.groups) {
    const entries = entriesByGroup.get(group.id) || [];
    const animals = new Map<string, ResolvedTreatment[]>();
    for (const entry of entries) {
      const current = animals.get(entry.identity) || [];
      current.push(entry);
      animals.set(entry.identity, current);
    }
    const deaths = observedDeathsByGroup.get(group.id) || [];
    const deadIdentities = new Set(deaths.map(death => identityFor(group, death.tag)));
    const allDeadIdentities = new Set(
      (deathsAsOfByGroup.get(group.id) || []).map(death => identityFor(group, death.tag)),
    );
    const cureEligibleIdentities = [...animals.entries()].flatMap(([identity, treatments]) => {
      const latestTreatmentDate = treatments.reduce(
        (latest, treatment) => (
          treatment.record.date > latest ? treatment.record.date : latest
        ),
        '',
      );
      return latestTreatmentDate && daysBetween(latestTreatmentDate, asOfDate) >= 30
        ? [identity]
        : [];
    });
    const curedHead = cureEligibleIdentities.filter(identity => !allDeadIdentities.has(identity)).length;
    const enumerable = enumerableIdentities(group);
    const countsByTreatment = new Map<number, { identifiedHead: number; deaths: number }>();
    for (const identity of enumerable) {
      const treatmentCount = animals.get(identity)?.length || 0;
      const current = countsByTreatment.get(treatmentCount) || { identifiedHead: 0, deaths: 0 };
      current.identifiedHead += 1;
      if (deadIdentities.has(identity)) current.deaths += 1;
      countsByTreatment.set(treatmentCount, current);
    }
    if (!countsByTreatment.has(0)) {
      countsByTreatment.set(0, { identifiedHead: 0, deaths: 0 });
    }
    const incomingHead = group.head ?? null;
    const identifiedHead = enumerable.size;
    groups.push({
      group,
      incomingHead,
      identifiedHead,
      unidentifiableHead: incomingHead === null ? null : Math.max(incomingHead - identifiedHead, 0),
      treatedHead: animals.size,
      treatmentEvents: entries.length,
      treatmentRate: ratio(animals.size, incomingHead, 'Incoming head count is unavailable'),
      treatmentsPerTreatedAnimal: ratio(entries.length, animals.size, 'No treated animals are available'),
      cureEligibleHead: cureEligibleIdentities.length,
      curedHead,
      cureRate: ratio(
        curedHead,
        cureEligibleIdentities.length,
        'No treated calves have at least 30 days of follow-up',
      ),
      observedDeaths: deadIdentities.size,
      observedMortality: ratio(deadIdentities.size, incomingHead, 'Incoming head count is unavailable'),
      mortalityByTreatmentCount: [...countsByTreatment].map(([treatmentCount, current]) => ({
        treatmentCount,
        ...current,
        observedMortality: ratio(current.deaths, current.identifiedHead, 'No identified animals are available'),
      })).sort((left, right) => left.treatmentCount - right.treatmentCount),
    });
  }
  groups.sort((left, right) => (
    left.group.date.localeCompare(right.group.date)
    || left.group.groupname.localeCompare(right.group.groupname)
    || left.group.id.localeCompare(right.group.id)
  ));
  const weeklyCodeCounts = new Map<string, WeeklyTreatmentCodeCount>();
  for (const entry of included) {
    const week = mondayFor(entry.record.date);
    const tokenized = tokenizeTreatmentProtocol(entry.record.treatment, records.treatmentTypes || []);
    for (const token of tokenized.tokens) {
      const key = `${week}|${token.code}`;
      const current = weeklyCodeCounts.get(key) || {
        week,
        treatmentCode: token.code,
        treatmentName: token.name,
        count: 0,
      };
      current.count += 1;
      weeklyCodeCounts.set(key, current);
    }
    if (tokenized.unknown.length > 0 || tokenized.tokens.length === 0) {
      const key = `${week}|UNKNOWN`;
      const current = weeklyCodeCounts.get(key) || {
        week,
        treatmentCode: 'UNKNOWN',
        treatmentName: 'Unknown or unconfigured treatment code',
        count: 0,
      };
      current.count += 1;
      weeklyCodeCounts.set(key, current);
    }
  }
  const retreatmentGapDays: number[] = [];
  for (const entries of treatmentsByAnimal.values()) {
    const ordered = [...entries].sort((left, right) => left.record.date.localeCompare(right.record.date));
    for (let index = 1; index < ordered.length; index += 1) {
      retreatmentGapDays.push(daysBetween(
        ordered[index - 1]!.record.date,
        ordered[index]!.record.date,
      ));
    }
  }
  return {
    events: counts,
    uniqueTreatedHead,
    treatmentsPerTreatedAnimal: ratio(
      included.length,
      uniqueTreatedHead,
      'No matched treated animals are available',
    ),
    retreatmentRate: ratio(
      retreated,
      uniqueTreatedHead,
      'No matched treated animals are available',
    ),
    weekly: countWeeks(included.map(entry => entry.record.date)),
    weeklyByTreatmentCode: [...weeklyCodeCounts.values()].sort((left, right) => (
      left.week.localeCompare(right.week)
      || left.treatmentCode.localeCompare(right.treatmentCode)
    )),
    protocols: [...protocolCounts].map(([protocol, count]) => ({ protocol, count }))
      .sort((left, right) => right.count - left.count || left.protocol.localeCompare(right.protocol)),
    retreatmentGaps: {
      intervalsIncluded: retreatmentGapDays.length,
      sourceEventsExcluded: counts.excluded + treatmentsByAnimal.size,
      exclusionReasons: {
        firstTreatment: treatmentsByAnimal.size,
        notag: counts.reasons.notag,
        unmatchedGroup: counts.reasons.unmatchedGroup,
      },
      values: countDays(retreatmentGapDays),
    },
    groups,
  };
}

export function computeDeadAnalytics(
  records: LivestockRecords,
  filters: AnalyticsFilters = {},
): DeadAnalytics {
  const indexes = records.indexes || buildLivestockIndexes(records);
  const treatedIdentitiesByGroup = new Map<string, Set<string>>();
  for (const treatment of treatmentEntries(records, filters).included) {
    const current = treatedIdentitiesByGroup.get(treatment.group.id) || new Set<string>();
    current.add(treatment.identity);
    treatedIdentitiesByGroup.set(treatment.group.id, current);
  }
  const counts = emptyCounts();
  const included: {
    date: string;
    tag: Tag;
    group: IncomingRecord;
    identity: string;
    daysOnFeed: number;
    treatedBeforeDeath: boolean;
    lastTreatmentDate?: string;
  }[] = [];
  for (const record of records.dead.records) {
    if (!inDateRange(record.date, filters)) continue;
    for (const tag of record.tags) {
      const group = tag.color.toUpperCase() === 'NOTAG'
        ? false
        : groupForTagInIndex(indexes.groupsByTag, indexes.groupsByName, tag, record.date);
      if (group && filters.groupnames?.length && !filters.groupnames.includes(group.groupname)) {
        continue;
      }
      counts.total += 1;
      if (tag.color.toUpperCase() === 'NOTAG') {
        counts.excluded += 1;
        counts.reasons.notag += 1;
        continue;
      }
      if (!group || calendarDate(record.date) < calendarDate(group.date)) {
        counts.excluded += 1;
        counts.reasons.unmatchedGroup += 1;
        continue;
      }
      counts.included += 1;
      if (group.head === undefined) counts.denominatorExcluded += 1;
      const identity = identityFor(group, tag);
      const treatments = indexes.treatmentsByTag[tagKey(tag)] || [];
      const priorTreatments = treatments.filter(treatment => (
        treatment.group
        && treatment.group.id === group.id
        && treatment.record.date <= record.date
      )).sort((left, right) => right.record.date.localeCompare(left.record.date));
      const lastTreatmentDate = priorTreatments[0]?.record.date;
      included.push({
        date: record.date,
        tag,
        group,
        identity,
        daysOnFeed: daysBetween(group.date, record.date),
        treatedBeforeDeath: !!lastTreatmentDate,
        lastTreatmentDate,
      });
    }
  }
  const groupEntries = new Map<string, typeof included>();
  for (const entry of included) {
    const current = groupEntries.get(entry.group.id) || [];
    current.push(entry);
    groupEntries.set(entry.group.id, current);
  }
  const cohorts = cohortUniverse(records, filters);
  const groups: DeadGroupAnalytics[] = cohorts.groups.map(group => {
    const entries = groupEntries.get(group.id) || [];
    const treatedBeforeDeath = entries.filter(entry => entry.treatedBeforeDeath).length;
    const untreatedBeforeDeath = entries.length - treatedBeforeDeath;
    const treatedHead = treatedIdentitiesByGroup.get(group.id)?.size || 0;
    return {
      group,
      incomingHead: group.head ?? null,
      treatedHead,
      treatmentRate: ratio(
        treatedHead,
        group.head ?? null,
        'Incoming head count is unavailable',
      ),
      deaths: entries.length,
      mortalityRate: ratio(entries.length, group.head ?? null, 'Incoming head count is unavailable'),
      averageDaysOnFeedAtDeath: ratio(
        entries.reduce((sum, entry) => sum + entry.daysOnFeed, 0),
        entries.length,
        'No matched deaths are available',
      ),
      treatedBeforeDeath,
      shareTreatedBeforeDeath: ratio(
        treatedBeforeDeath,
        entries.length,
        'No matched deaths are available',
      ),
      untreatedBeforeDeath,
      shareUntreatedBeforeDeath: ratio(
        untreatedBeforeDeath,
        entries.length,
        'No matched deaths are available',
      ),
    };
  }).sort((left, right) => left.group.groupname.localeCompare(right.group.groupname));
  const groupsMissingHead = groups.filter(group => group.incomingHead === null);
  const overallHead = groupsMissingHead.length || cohorts.missingGroupnames.length
    ? null
    : groups.reduce((sum, group) => sum + (group.incomingHead || 0), 0);
  const treatedBeforeDeath = included.filter(entry => entry.treatedBeforeDeath).length;
  const lastTreatmentGapDays = included.flatMap(entry => (
    entry.lastTreatmentDate ? [daysBetween(entry.lastTreatmentDate, entry.date)] : []
  ));
  const noPriorTreatment = included.length - lastTreatmentGapDays.length;
  const missingDenominatorReason = cohorts.missingGroupnames.length
    ? `Selected cohorts were not found: ${cohorts.missingGroupnames.join(', ')}`
    : groupsMissingHead.length
      ? `Incoming head count is unavailable for ${groupsMissingHead.map(group => group.group.groupname).join(', ')}`
      : 'No cohort head denominator is available';
  return {
    deaths: counts,
    mortalityRate: ratio(
      included.length,
      overallHead,
      missingDenominatorReason,
    ),
    averageDaysOnFeedAtDeath: ratio(
      included.reduce((sum, entry) => sum + entry.daysOnFeed, 0),
      included.length,
      'No matched deaths are available',
    ),
    treatedBeforeDeath,
    shareTreatedBeforeDeath: ratio(
      treatedBeforeDeath,
      included.length,
      'No matched deaths are available',
    ),
    weekly: countWeeks(included.map(entry => entry.date)),
    daysOnFeedDistribution: {
      deathsIncluded: included.length,
      deathsExcluded: counts.excluded,
      values: countDays(included.map(entry => entry.daysOnFeed)),
    },
    lastTreatmentToDeath: {
      intervalsIncluded: lastTreatmentGapDays.length,
      deathsExcluded: counts.excluded + noPriorTreatment,
      exclusionReasons: {
        noPriorTreatment,
        notag: counts.reasons.notag,
        unmatchedGroup: counts.reasons.unmatchedGroup,
      },
      values: countDays(lastTreatmentGapDays),
    },
    groups,
  };
}

function deathDateByIdentity(
  records: LivestockRecords,
  group: IncomingRecord,
): Map<string, string> {
  const indexes = records.indexes || buildLivestockIndexes(records);
  const dates = new Map<string, string>();
  for (const death of Object.values(indexes.deathsByTag).flat()) {
    if (!death.group || death.group.id !== group.id) continue;
    if (calendarDate(death.record.date) < calendarDate(group.date)) continue;
    if (death.tag.color.toUpperCase() === 'NOTAG') continue;
    const identity = identityFor(death.group, death.tag);
    const current = dates.get(identity);
    if (!current || death.record.date < current) dates.set(identity, death.record.date);
  }
  return dates;
}

function treatmentCountByIdentity(
  records: LivestockRecords,
  group: IncomingRecord,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of treatmentEntries(records, { groupnames: [group.groupname] }).included) {
    if (entry.group.id !== group.id) continue;
    if (calendarDate(entry.record.date) < calendarDate(group.date)) continue;
    counts.set(entry.identity, (counts.get(entry.identity) || 0) + 1);
  }
  return counts;
}

function bucketsFromAnimals(
  byDate: Map<string, Map<string, GroupDayAnimal>>,
): GroupDayBucket[] {
  return [...byDate].map(([date, animals]) => ({
    date,
    count: animals.size,
    animals: [...animals.values()].sort((left, right) => (
      left.color.localeCompare(right.color) || left.number - right.number
    )),
  })).sort((left, right) => right.date.localeCompare(left.date));
}

export function listGroupTreatmentDays(
  records: LivestockRecords,
  group: IncomingRecord | string,
  filters: AnalyticsFilters = {},
): GroupDayBucket[] {
  const target = resolveGroup(records, group);
  if (!target) return [];
  const lifetimeCounts = treatmentCountByIdentity(records, target);
  const deathDates = deathDateByIdentity(records, target);
  const visible = treatmentEntries(records, { ...filters, groupnames: [target.groupname] }).included
    .filter(entry => entry.group.id === target.id && calendarDate(entry.record.date) >= calendarDate(target.date));
  const byDate = new Map<string, Map<string, GroupDayAnimal>>();
  for (const entry of visible) {
    let animals = byDate.get(entry.record.date);
    if (!animals) {
      animals = new Map();
      byDate.set(entry.record.date, animals);
    }
    const existing = animals.get(entry.identity);
    const protocol = existing?.protocol && existing.protocol !== entry.record.treatment
      ? `${existing.protocol}, ${entry.record.treatment}`
      : entry.record.treatment;
    animals.set(entry.identity, {
      color: entry.tag.color,
      number: entry.tag.number,
      protocol,
      treatmentCount: lifetimeCounts.get(entry.identity) || 0,
      deathDate: deathDates.get(entry.identity),
    });
  }
  return bucketsFromAnimals(byDate);
}

function resolveGroup(
  records: LivestockRecords,
  group: IncomingRecord | string,
): IncomingRecord | undefined {
  if (typeof group !== 'string') return group;
  return records.incoming.records.find(candidate => candidate.groupname === group);
}

export function listGroupDeathDays(
  records: LivestockRecords,
  group: IncomingRecord | string,
  filters: AnalyticsFilters = {},
): GroupDayBucket[] {
  const target = resolveGroup(records, group);
  if (!target) return [];
  const indexes = records.indexes || buildLivestockIndexes(records);
  const lifetimeTreatments = treatmentEntries(records, { groupnames: [target.groupname] }).included
    .filter(entry => entry.group.id === target.id);
  const byDate = new Map<string, Map<string, GroupDayAnimal>>();
  for (const record of records.dead.records) {
    if (!inDateRange(record.date, filters)) continue;
    for (const tag of record.tags) {
      const assigned = tag.color.toUpperCase() === 'NOTAG'
        ? false
        : groupForTagInIndex(indexes.groupsByTag, indexes.groupsByName, tag, record.date);
      if (!assigned || assigned.id !== target.id) continue;
      if (calendarDate(record.date) < calendarDate(target.date)) continue;
      const identity = identityFor(assigned, tag);
      let animals = byDate.get(record.date);
      if (!animals) {
        animals = new Map();
        byDate.set(record.date, animals);
      }
      const priorTreatments = lifetimeTreatments.filter(entry => (
        entry.identity === identity && entry.record.date <= record.date
      )).length;
      animals.set(identity, {
        color: tag.color,
        number: tag.number,
        treatmentCount: priorTreatments,
        deathDate: record.date,
      });
    }
  }
  return bucketsFromAnimals(byDate);
}
