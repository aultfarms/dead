import type {
  DeadRecord,
  IncomingRecord,
  LivestockIndexes,
  LivestockRecords,
  Tag,
  TagGroupIndex,
  TagRange,
} from './types.js';

const warn = (..._args: unknown[]) => undefined;
//-------------------------------------------------------------
// Tag Helpers
//-------------------------------------------------------------

// Note that a tag range is pre-processed to ensure that it
// only has tags of the same color.  If there is a color
// split on a group, the group will have 2 separate ranges.
export function calendarDate(value: string | undefined | null): string {
  if (!value) return '';
  const match = value.trim().match(/^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})/);
  if (!match) return '';
  return `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`;
}

export function rangeContainsTag(r: TagRange, tag: Tag): boolean {
  return (
    tag.color.trim().toUpperCase() === r.start.color.trim().toUpperCase() &&
    tag.number >= r.start.number &&
    tag.number <= r.end.number
  );
}

export function groupContainsTag(group: IncomingRecord, tag: Tag): boolean {
  return !!group.tags?.find(r => rangeContainsTag(r,tag));
};
export function tagKey(tag: Tag): string {
  return `${tag.color.trim().toUpperCase()}${tag.number}`;
}

export function sameTag(left: Tag, right: Tag): boolean {
  return left.number === right.number
    && left.color.trim().toUpperCase() === right.color.trim().toUpperCase();
}

export function buildTagGroupIndex(groups: IncomingRecord[]): TagGroupIndex {
  const index: TagGroupIndex = {};
  for (const group of groups) {
    for (const range of group.tags || []) {
      for (let number = range.start.number; number <= range.end.number; number += 1) {
        const key = tagKey({ color: range.start.color, number });
        if (!index[key]) index[key] = [];
        index[key]!.push(group);
      }
    }
  }
  for (const candidates of Object.values(index)) {
    candidates.sort((left, right) => left.date.localeCompare(right.date));
  }
  return index;
}

export function groupForTagInIndex(
  index: TagGroupIndex,
  groupsByName: { [groupname: string]: IncomingRecord },
  tag: Tag,
  asOfDateString?: string,
): IncomingRecord | false {
  const asOfDate = calendarDate(asOfDateString);
  if (!asOfDate) return false;
  if (tag.groupname) {
    const named = groupsByName[tag.groupname];
    const arrived = named ? calendarDate(named.date) : '';
    if (named && arrived && arrived <= asOfDate) return named;
  }
  const eligible = (index[tagKey(tag)] || []).filter(group => {
    const arrived = calendarDate(group.date);
    return Boolean(arrived) && arrived <= asOfDate;
  });
  return eligible[eligible.length - 1] || false;
}


// groupForTag has to deal with historic repeated tag color/number
// combinations.  i.e. 3 years ago another "RED13" may have existed.
// We need to figure out which one of these is the "correct" one.
// This can be slightly fuzzy, because one or two mistakes is not
// going to break the bank.
//
// The simplest algorithm is one that assumes there is only one
// of each combo on-site at any given time.  Therefore, when a 
// new group comes in and gets tagged, they supercede any previous
// version of that tag.  So the "latest" copy of the tag is always
// the "correct" one for "today".
//
// Unfortunately, sometimes our scripts may want to compute historic death
// loss and things like that.  "historic" means sometimes we're looking in 
// a date range that is not "today".  Therefore, we have to uglify this 
// function definition by adding a third optional parameter of "asOfDate"
// which is the ballpark date of interest: i.e. it will take the tag number
// as of that day.
export function groupForTag(
  records: LivestockRecords,
  tag: Tag,
  asOfDateString: string | false = false
): IncomingRecord | false {
  const groups = records.incoming.records;
  const asOfDate = calendarDate(asOfDateString || new Date().toISOString().slice(0, 10));
  if (!asOfDate) return false;
  if (tag && tag.groupname) {
    const named = groups.find(g => g.groupname === tag.groupname);
    const arrived = named ? calendarDate(named.date) : '';
    if (named && arrived && arrived <= asOfDate) return named;
  }

  const allfound = groups.filter(g => groupContainsTag(g,tag));
  // if none, return false:
  if (!allfound || allfound.length < 1) return false;

  const filteredToDate = allfound.filter(g => {
    const arrived = calendarDate(g.date);
    return Boolean(arrived) && arrived <= asOfDate;
  });
  if (!filteredToDate || filteredToDate.length < 1) {
    warn('WARNING: groupForTag: found multiple possible groups (',allfound,') for tag (',tag,'), but after filtering for date (',asOfDate,') there were none left!');
    return false;
  }
  // string comparison below from https://stackoverflow.com/questions/1179366/is-there-a-javascript-strcmp:
  filteredToDate.sort((g1,g2) => (g1.date < g2.date ? -1 : +(g1.date > g2.date)));
  // default lexical sorting will put oldest on top, newest on bottom.  
  // Need to take the newest one that is prior to the reference date
  return filteredToDate[filteredToDate.length-1] || false;
};

export function buildLivestockIndexes(records: LivestockRecords): LivestockIndexes {
  const groupsByName: { [groupname: string]: IncomingRecord } = {};
  for (const group of records.incoming.records) groupsByName[group.groupname] = group;
  const groupsByTag = buildTagGroupIndex(records.incoming.records);
  const indexes: LivestockIndexes = {
    groupsByName,
    groupsByTag,
    treatmentsByTag: {},
    deathsByTag: {},
    unmatchedTreatments: [],
    unmatchedDeaths: [],
  };

  for (const record of records.treatments.records) {
    for (const tag of record.tags) {
      const group = tag.color.toUpperCase() === 'NOTAG'
        ? false
        : groupForTagInIndex(groupsByTag, groupsByName, tag, record.date);
      const indexed = { record, tag, group };
      const key = tagKey(tag);
      if (!indexes.treatmentsByTag[key]) indexes.treatmentsByTag[key] = [];
      indexes.treatmentsByTag[key]!.push(indexed);
      if (!group) indexes.unmatchedTreatments.push(indexed);
    }
  }

  for (const record of records.dead.records) {
    for (const tag of record.tags) {
      const group = tag.color.toUpperCase() === 'NOTAG'
        ? false
        : groupForTagInIndex(groupsByTag, groupsByName, tag, record.date);
      const indexed = { record, tag, group };
      const key = tagKey(tag);
      if (!indexes.deathsByTag[key]) indexes.deathsByTag[key] = [];
      indexes.deathsByTag[key]!.push(indexed);
      if (!group) indexes.unmatchedDeaths.push(indexed);
    }
  }
  return indexes;
}

export type DuplicateDeath = {
  record: DeadRecord;
  tag: Tag;
  daysApart: number;
};

function dateAsUtcDays(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

export function findDuplicateDeath(
  records: DeadRecord[],
  tag: Tag,
  date: string,
  options: { windowDays?: number; excludeCardId?: string } = {},
): DuplicateDeath | false {
  // NOTAG is an explicit statement that the animal cannot be identified.
  // Repeated NOTAG values can represent different animals and must not be
  // treated as the same identity by the duplicate guard.
  if (tag.color.trim().toUpperCase() === 'NOTAG') return false;
  const windowDays = options.windowDays ?? 14;
  const targetDay = dateAsUtcDays(date);
  for (const record of records) {
    if (options.excludeCardId && record.id === options.excludeCardId) continue;
    const matchingTag = record.tags.find(candidate => sameTag(candidate, tag));
    if (!matchingTag) continue;
    const daysApart = Math.abs(dateAsUtcDays(record.date) - targetDay);
    if (daysApart <= windowDays) return { record, tag: matchingTag, daysApart };
  }
  return false;
}

export function tagStrToObj(str:string): Tag | null {
  str = str.trim();
  // First, check if it is group-prefixed tag:
  const groupmatches = str.match(/^([A-Z]+:[A-Z]{3}[0-9]{2}-[0-9A-Z]):([A-Za-z]+) *([0-9]+)$/);
  if (groupmatches) {
    if (!groupmatches[2]) {
      warn('WARNING: attempted to convert string ', str, 'to tag, but color was invalid.  Matches = ', groupmatches);
    }
    return { 
      groupname: groupmatches[1], 
      color: groupmatches[2] || 'UNKNOWNCOLOR', 
      number: +(groupmatches[3] || 1) 
    };
  }
  // Otherwise, it is just a color/number combo:
  const matches = str.match(/^([A-Za-z]+) ?([0-9]+)?$/);
  if (!matches) {
    warn('WARNING: tag string', str, 'did not match pattern for a tag string');
    return null;
  }

  if (!matches[1] || !matches[2]) {
    warn('WARNING: attempted to convert string ', str, 'to tag (not a group tag), but had invalid matches.  Matches = ', matches);
    return null;
  }
  return { 
    color: matches[1] || 'UNKNOWNCOLOR', 
    number: +(matches[2] || 1),
  };
}

export function tagObjToStr(t: Tag): string {
  if (!t) {
    warn('WARNING: attempted to convert tag object', t, 'to string, but t was falsey');
    return '';
  }
  let str = '';
  if (t.groupname) str += t.groupname+':'; // group:colornumber
  str += (t.color || '');
  str += (t.number || '');
  return str;
}


