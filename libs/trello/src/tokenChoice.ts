const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export type TokenSource = 'hash' | 'storage' | 'none';

export type TokenChoice = {
  token: string;
  source: TokenSource;
  hashPresent: boolean;
  hashError: string;
  hashTokenLength: number;
  hashTokenLooksValid: boolean;
  storedPresent: boolean;
  storedIgnoredBecauseHash: boolean;
};

export type OrganizationStatus = 'found' | 'missing' | 'not checked';
export type BoardStatus = 'found' | 'missing' | 'not checked';

export type AuthorizationFacts = {
  openedFrom: string;
  serviceWorker: string;
  trelloReturn: boolean;
  hashDescription: string;
  storedDescription: string;
  saveDescription: string;
  membersDescription: string;
  organizations: string[];
  organizationFound: OrganizationStatus;
  livestockBoard: BoardStatus;
  failureStep: string;
};

export type AuthorizationReport = {
  summary: string;
  lines: string[];
};

export function chooseTrelloToken(input: { stored: string; hash: string }): TokenChoice {
  const rawHash = input.hash.startsWith('#') ? input.hash.slice(1) : input.hash;
  const hashPresent = rawHash.length > 0;
  const params = new URLSearchParams(rawHash);
  const hashError = hashPresent ? (params.get('error') || '') : '';
  const hashToken = hashPresent ? (params.get('token') || '') : '';
  const hashTokenLooksValid = TOKEN_PATTERN.test(hashToken);
  const stored = input.stored.trim();
  const storedPresent = stored.length > 0;
  const described = {
    hashPresent,
    hashError,
    hashTokenLength: hashToken.length,
    hashTokenLooksValid,
    storedPresent,
    storedIgnoredBecauseHash: false,
  };
  if (hashError) {
    return { ...described, token: '', source: 'none' };
  }
  if (hashTokenLooksValid) {
    return {
      ...described,
      token: hashToken,
      source: 'hash',
      storedIgnoredBecauseHash: storedPresent,
    };
  }
  if (storedPresent) {
    return { ...described, token: stored, source: 'storage' };
  }
  return { ...described, token: '', source: 'none' };
}

export function canonicalTrelloReturnUrl(href: string): string {
  const url = new URL(href);
  url.hash = '';
  if (url.hostname === 'aultfarms.github.io') {
    url.protocol = 'https:';
    url.hostname = 'aultfarms.com';
  }
  if (url.pathname === '/dead' || url.pathname === '/treatments') {
    url.pathname += '/';
  }
  return `${url.origin}${url.pathname}${url.search}`;
}

export function describeTokenChoice(
  choice: TokenChoice,
  storageReadError: string,
): { hashDescription: string; storedDescription: string } {
  let hashDescription = 'absent';
  if (choice.hashError) {
    hashDescription = `present with error "${choice.hashError}"`;
  } else if (choice.hashPresent && choice.hashTokenLength === 0) {
    hashDescription = 'present, but it has no token';
  } else if (choice.hashPresent && choice.hashTokenLooksValid) {
    hashDescription = `present with a token of ${choice.hashTokenLength} characters that looks like a Trello token`;
  } else if (choice.hashPresent) {
    hashDescription = `present with a token of ${choice.hashTokenLength} characters that does not look like a Trello token`;
  }

  let storedDescription = 'absent';
  if (storageReadError) {
    storedDescription = `unreadable (${storageReadError})`;
  } else if (choice.storedIgnoredBecauseHash) {
    storedDescription = 'present and ignored because a redirect token was also present';
  } else if (choice.storedPresent) {
    storedDescription = 'present';
  }
  return { hashDescription, storedDescription };
}

function initialFacts(): AuthorizationFacts {
  return {
    openedFrom: 'Safari',
    serviceWorker: 'No service worker is controlling this page.',
    trelloReturn: false,
    hashDescription: 'absent',
    storedDescription: 'absent',
    saveDescription: 'No redirect token to save.',
    membersDescription: 'Not called.',
    organizations: [],
    organizationFound: 'not checked',
    livestockBoard: 'not checked',
    failureStep: '',
  };
}

let facts = initialFacts();

export function updateAuthorizationFacts(partial: Partial<AuthorizationFacts>): void {
  facts = { ...facts, ...partial };
}

export function noteTrelloAccess(update: Partial<Pick<
  AuthorizationFacts,
  'organizations' | 'organizationFound' | 'livestockBoard' | 'failureStep'
>>): void {
  updateAuthorizationFacts(update);
}

export function formatAuthorizationReport(current: AuthorizationFacts): AuthorizationReport {
  const lines = [
    `Opened from ${current.openedFrom}.`,
    current.serviceWorker,
    current.trelloReturn
      ? 'This load looks like a return from Trello.'
      : 'This load does not look like a return from Trello.',
    `Hash: ${current.hashDescription}.`,
    `Saved token: ${current.storedDescription}.`,
    `Saving the redirect token: ${current.saveDescription}`,
    `Trello member check: ${current.membersDescription}`,
    current.organizations.length
      ? `Organizations: ${current.organizations.join(', ')}.`
      : 'Organizations: not loaded yet.',
    `Ault Farms organization: ${current.organizationFound}.`,
    `Livestock board: ${current.livestockBoard}.`,
  ];
  return {
    summary: current.failureStep || 'Log in with Trello to continue.',
    lines,
  };
}

export function getAuthorizationReport(): AuthorizationReport {
  return formatAuthorizationReport(facts);
}
